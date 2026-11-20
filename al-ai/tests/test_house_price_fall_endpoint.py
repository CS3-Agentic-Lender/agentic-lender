from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import auth, portfolio_endpoint
from app.main import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer ok"}
URL = "/ai/portfolio/downturn"


def mortgage(**changes):
    base = {
        "status": "Applied", "loanType": "mortgage", "loanAmountEur": 240_000,
        "property": {"askingPriceEur": 300_000, "county": "Cork"}, "estimatedValueEur": 320_000,
    }
    return {**base, **changes}


def heloc(**changes):
    base = {"status": "Funded", "loanType": "heloc", "loanAmountEur": 50_000, "existingMortgageBalanceEur": 150_000, "estimatedValueEur": 400_000}
    return {**base, **changes}


@pytest.fixture
def signed_in(monkeypatch):
    role = {"value": "underwriter"}
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": role["value"]})
    return role


@pytest.fixture
def portfolio(monkeypatch, signed_in):
    """The loader's answer: the active applications, each with its id."""
    state = SimpleNamespace(docs=[])
    monkeypatch.setattr(portfolio_endpoint, "load_active_applications", lambda: state.docs)
    return state


def post(payload, headers=AUTH):
    return client.post(URL, json=payload, headers=headers)


def test_it_returns_each_application_and_the_totals(portfolio):
    portfolio.docs = [{"id": "m1", **mortgage()}, {"id": "h1", **heloc()}]
    r = post({"fall_pct": 20})
    assert r.status_code == 200
    j = r.json()
    assert j["fall_pct"] == 20 and j["totals"]["count"] == 2 and j["skipped"] == [] and "not a verified valuation" in j["note"]
    by_id = {a["application_id"]: a for a in j["applications"]}
    # The mortgage: asking 300,000 is the lower value, 240,000 / 240,000 after a 20% fall. The HELOC: 200,000 / 320,000.
    assert by_id["m1"]["value_basis"] == "asking_price" and by_id["m1"]["after"] == {"property_value_eur": 240_000.0, "ltv_pct": 100.0, "above_80": True, "above_90": True}
    assert by_id["h1"]["value_basis"] == "model_estimate" and by_id["h1"]["after"]["ltv_pct"] == 62.5
    assert j["totals"]["after"]["above_90"] == {"count": 1, "loan_eur": 240_000.0}


def test_the_asking_price_is_read_from_the_property_map(portfolio):
    portfolio.docs = [{"id": "m1", **mortgage(estimatedValueEur=None)}]
    a = post({"fall_pct": 0}).json()["applications"][0]
    assert a["value_basis"] == "asking_price" and a["starting_value_eur"] == 300_000


def test_a_bad_application_is_skipped_and_listed(portfolio):
    portfolio.docs = [{"id": "ok", **mortgage()}, {"id": "no-property", **mortgage(property=None)}, {"id": "odd", **mortgage(loanType="reverse")}]
    j = post({"fall_pct": 10}).json()
    assert j["totals"]["count"] == 1 and sorted(s["application_id"] for s in j["skipped"]) == ["no-property", "odd"]


def test_an_empty_portfolio_is_200_with_zero_counts(portfolio):
    j = post({"fall_pct": 10}).json()
    assert j["applications"] == [] and j["totals"]["count"] == 0


@pytest.mark.parametrize("bad", [-5, 3, 41, 45, 100, 20.5, "20", None, True])
def test_a_fall_outside_0_to_40_in_steps_of_5_is_422_naming_the_field(portfolio, bad):
    r = post({"fall_pct": bad})
    assert r.status_code == 422 and r.json()["error"]["field"] == "fall_pct"


@pytest.mark.parametrize("good", list(range(0, 41, 5)))
def test_every_step_from_0_to_40_is_accepted(portfolio, good):
    assert post({"fall_pct": good}).status_code == 200


def test_a_stray_field_is_refused(portfolio):
    assert post({"fall_pct": 10, "shock_bps": 100}).status_code == 422


@pytest.mark.parametrize("role", ["borrower", "broker"])
def test_only_an_underwriter_may_run_it(portfolio, signed_in, role):
    signed_in["value"] = role
    r = post({"fall_pct": 10})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"


def test_no_token_is_401(portfolio):
    assert client.post(URL, json={"fall_pct": 10}).status_code == 401


# ---- the loader, against a stand-in for Firestore ---------------------------------------------

class FakeDoc:
    def __init__(self, doc_id, fields):
        self.id = doc_id
        self._fields = fields

    def to_dict(self):
        return self._fields


class FakeDb:
    def __init__(self, applications):
        self.calls = []
        self._applications = applications

    def collection(self, name):
        self.calls.append(("collection", name))
        return SimpleNamespace(where=lambda filter: SimpleNamespace(stream=lambda: self._applications))

    def collection_group(self, name):  # the house price fall must not read the reviews
        self.calls.append(("collection_group", name))
        raise AssertionError("the house price fall reads no review documents")


def test_the_loader_reads_the_active_applications_in_one_query(monkeypatch):
    db = FakeDb([FakeDoc("a1", mortgage()), FakeDoc("a2", heloc())])
    monkeypatch.setattr(portfolio_endpoint, "_db", lambda: db)
    docs = portfolio_endpoint.load_active_applications()
    assert [d["id"] for d in docs] == ["a1", "a2"] and docs[0]["loanType"] == "mortgage"
    assert db.calls == [("collection", "applications")]
