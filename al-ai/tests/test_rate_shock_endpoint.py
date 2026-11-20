from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import auth, portfolio_endpoint, rates
from app.main import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer ok"}


def application(**changes):
    base = {
        "status": "Applied", "loanAmountEur": 300_000, "termYears": 30, "grossIncomeEur": 80_000, "monthlyTakeHomeEur": 4_500,
        "monthlyDebtsEur": 200, "monthlyLivingCostsEur": 1_500,
    }
    return {**base, **changes}


@pytest.fixture
def signed_in(monkeypatch):
    role = {"value": "underwriter"}
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": role["value"]})
    return role


@pytest.fixture
def portfolio(monkeypatch, signed_in):
    """The loader's answer: (applications with their ids, stored rates). The ECB rate is 3.5% and counts its calls."""
    state = SimpleNamespace(docs=[], stored={}, ecb_calls=0)
    monkeypatch.setattr(portfolio_endpoint, "load_portfolio", lambda: (state.docs, state.stored))

    def get_rate(name, **kw):
        state.ecb_calls += 1
        return rates.Rate(name, 3.5, "2026-10", 4.0, "2025-10", datetime(2026, 11, 1, tzinfo=UTC))

    monkeypatch.setattr(rates, "get_rate", get_rate)
    return state


def post(payload, headers=AUTH):
    return client.post("/ai/portfolio/rate-shock", json=payload, headers=headers)


def test_it_returns_each_application_and_the_totals(portfolio):
    portfolio.docs = [{"id": "a1", **application()}, {"id": "a2", **application(status="Funded", grossIncomeEur=60_000)}]
    portfolio.stored = {"a1": 4.0, "a2": 4.0}
    r = post({"shock_bps": 200})
    assert r.status_code == 200
    j = r.json()
    assert j["shock_bps"] == 200 and j["totals"]["count"] == 2 and j["skipped"] == []
    first = j["applications"][0]
    assert first["application_id"] == "a1" and first["rate_source"] == "stored"
    assert first["before"]["repayment_eur"] == 1432.25 and first["after"]["repayment_eur"] == 1798.65
    assert portfolio.ecb_calls == 0  # every application had its own rate, so the ECB was not asked


def test_an_application_with_no_stored_rate_uses_the_current_ecb_rate_and_says_so(portfolio):
    portfolio.docs = [{"id": "a1", **application()}, {"id": "a2", **application()}]
    portfolio.stored = {"a1": 4.0}
    j = post({"shock_bps": 100}).json()
    by_id = {a["application_id"]: a for a in j["applications"]}
    assert (by_id["a1"]["rate_source"], by_id["a1"]["benchmark_rate_pct"]) == ("stored", 4.0)
    assert (by_id["a2"]["rate_source"], by_id["a2"]["benchmark_rate_pct"], by_id["a2"]["shocked_rate_pct"]) == ("current", 3.5, 4.5)
    assert portfolio.ecb_calls == 1


def test_no_current_rate_means_503_not_a_guess(portfolio, monkeypatch):
    def unavailable(name, **kw):
        raise rates.RateUnavailable("the ECB is down")

    monkeypatch.setattr(rates, "get_rate", unavailable)
    portfolio.docs = [{"id": "a1", **application()}]
    r = post({"shock_bps": 100})
    assert r.status_code == 503 and r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_a_bad_application_is_skipped_and_listed(portfolio):
    portfolio.docs = [{"id": "ok", **application()}, {"id": "bad", **application(grossIncomeEur=None)}]
    portfolio.stored = {"ok": 4.0, "bad": 4.0}
    j = post({"shock_bps": 100}).json()
    assert j["totals"]["count"] == 1 and [s["application_id"] for s in j["skipped"]] == ["bad"]


def test_an_empty_portfolio_is_200_with_zero_counts(portfolio):
    j = post({"shock_bps": 100}).json()
    assert j["applications"] == [] and j["totals"]["count"] == 0 and portfolio.ecb_calls == 0


@pytest.mark.parametrize("bad", [0, 99, 110, 325, 301, 400, -100, 150.5, "200", None])
def test_a_shock_outside_100_to_300_in_steps_of_25_is_422_naming_the_field(portfolio, bad):
    r = post({"shock_bps": bad})
    assert r.status_code == 422 and r.json()["error"]["field"] == "shock_bps"


@pytest.mark.parametrize("good", list(range(100, 301, 25)))
def test_every_step_from_100_to_300_is_accepted(portfolio, good):
    assert post({"shock_bps": good}).status_code == 200


def test_a_stray_field_is_refused(portfolio):
    assert post({"shock_bps": 100, "rate": 5}).status_code == 422


@pytest.mark.parametrize("role", ["borrower", "broker"])
def test_only_an_underwriter_may_run_it(portfolio, signed_in, role):
    signed_in["value"] = role
    r = post({"shock_bps": 100})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"


def test_no_token_is_401(portfolio):
    assert client.post("/ai/portfolio/rate-shock", json={"shock_bps": 100}).status_code == 401


# ---- the loader, against a stand-in for Firestore ---------------------------------------------

class FakeDoc:
    def __init__(self, doc_id, fields, parent_id=None):
        self.id = doc_id
        self._fields = fields
        self.reference = SimpleNamespace(parent=SimpleNamespace(parent=SimpleNamespace(id=parent_id) if parent_id else None))

    def to_dict(self):
        return self._fields


class FakeDb:
    def __init__(self, applications, reviews):
        self.calls = []
        self._applications, self._reviews = applications, reviews

    def collection(self, name):
        self.calls.append(("collection", name))
        return SimpleNamespace(where=lambda filter: SimpleNamespace(stream=lambda: self._applications))

    def collection_group(self, name):
        self.calls.append(("collection_group", name))
        return SimpleNamespace(stream=lambda: self._reviews)


def test_the_loader_reads_the_stored_rate_of_each_application_in_two_queries(monkeypatch):
    db = FakeDb(
        [FakeDoc("a1", application()), FakeDoc("a2", application())],
        [
            FakeDoc("underwriting", {"dtiBreakdown": {"benchmarkRatePct": 3.9}}, "a1"),
            FakeDoc("underwriting", {"dtiBreakdown": {"benchmarkRatePct": 4.2}}, "a-not-active"),  # not in the active set
            FakeDoc("valuation", {"dtiBreakdown": {"benchmarkRatePct": 9.9}}, "a2"),  # another review document
            FakeDoc("underwriting", {}, "a2"),  # no breakdown yet
        ],
    )
    monkeypatch.setattr(portfolio_endpoint, "_db", lambda: db)
    docs, stored = portfolio_endpoint.load_portfolio()
    assert [d["id"] for d in docs] == ["a1", "a2"] and stored == {"a1": 3.9}
    assert db.calls == [("collection", "applications"), ("collection_group", "review")]
