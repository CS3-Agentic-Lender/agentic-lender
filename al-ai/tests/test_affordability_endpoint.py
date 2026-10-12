import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer ok"}
KEYS = {
    "max_loan_eur", "max_property_price_eur", "monthly_repayment_eur", "stressed_repayment_eur",
    "limited_by", "benchmark_rate_pct", "stressed_rate_pct", "rate_date",
}


@pytest.fixture(autouse=True)
def signed_in_with_a_rate(monkeypatch):
    # The reference cases use a 4.00% test rate. The rate is a stand-in setting until the ECB rate tool exists.
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": "borrower"})
    monkeypatch.setenv("BENCHMARK_RATE_PCT", "4.0")
    monkeypatch.setenv("BENCHMARK_RATE_DATE", "2026-08")


def body(**changes):
    base = {"gross_income_eur": 60_000, "monthly_debts_eur": 0, "deposit_eur": 40_000, "term_years": 30, "first_time_buyer": True}
    return {**base, **changes}


def post(payload, headers=AUTH):
    return client.post("/ai/affordability", json=payload, headers=headers)


# ---- the three reference cases from the ticket ---------------------------------------------

def test_reference_case_one_is_limited_by_income():
    r = post(body())
    assert r.status_code == 200
    j = r.json()
    assert set(j) == KEYS
    assert j["max_loan_eur"] == pytest.approx(240_000)
    assert j["max_property_price_eur"] == pytest.approx(280_000)
    assert j["monthly_repayment_eur"] == pytest.approx(1145.80, abs=0.005)
    assert j["stressed_repayment_eur"] == pytest.approx(1438.92, abs=0.005)
    assert j["limited_by"] == "income"
    assert (j["benchmark_rate_pct"], j["stressed_rate_pct"], j["rate_date"]) == (4.0, 6.0, "2026-08")


def test_reference_case_two_joint_movers_is_limited_by_deposit():
    r = post(body(gross_income_eur=90_000, deposit_eur=30_000, term_years=25, first_time_buyer=False))
    j = r.json()
    assert j["max_loan_eur"] == pytest.approx(270_000)
    assert j["max_property_price_eur"] == pytest.approx(300_000)
    assert j["monthly_repayment_eur"] == pytest.approx(1425.16, abs=0.005)
    assert j["stressed_repayment_eur"] == pytest.approx(1739.61, abs=0.005)
    assert j["limited_by"] == "deposit"


def test_reference_case_three_is_limited_by_debts():
    r = post(body(monthly_debts_eur=1_000, deposit_eur=50_000))
    j = r.json()
    assert round(j["max_loan_eur"]) == 166_792
    assert round(j["max_property_price_eur"]) == 216_792
    assert j["monthly_repayment_eur"] == pytest.approx(796.29, abs=0.005)
    assert j["stressed_repayment_eur"] == pytest.approx(1000.00, abs=0.005)  # debts + this = exactly 40% of 5,000
    assert j["limited_by"] == "debts"


def test_other_buyers_get_the_lower_income_multiple():
    # 3.5x of 60,000 is 210,000, even with a deposit big enough for more
    j = post(body(first_time_buyer=False, deposit_eur=100_000)).json()
    assert j["max_loan_eur"] == pytest.approx(210_000) and j["limited_by"] == "income"


def test_no_deposit_means_no_loan():
    j = post(body(deposit_eur=0)).json()
    assert j["max_loan_eur"] == 0 and j["limited_by"] == "deposit"


# ---- who may call it and what happens with bad input ---------------------------------------

def test_missing_token_is_401_in_the_shared_shape():
    r = post(body(), headers={})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.parametrize("field, value", [
    ("gross_income_eur", 0),
    ("gross_income_eur", -1),
    ("monthly_debts_eur", -1),
    ("deposit_eur", -1),
    ("gross_income_eur", 10_000_001),
    ("term_years", 0),
    ("term_years", 4),
    ("term_years", 36),
    ("first_time_buyer", "maybe"),
])
def test_bad_input_is_422_and_names_the_field(field, value):
    r = post(body(**{field: value}))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INVALID_FIELD" and r.json()["error"]["field"] == field


@pytest.mark.parametrize("field", ["gross_income_eur", "monthly_debts_eur", "deposit_eur", "term_years", "first_time_buyer"])
def test_a_missing_field_is_422_and_names_the_field(field):
    payload = body()
    del payload[field]
    r = post(payload)
    assert r.status_code == 422 and r.json()["error"]["field"] == field


# ---- the rate is never made up --------------------------------------------------------------

@pytest.mark.parametrize("missing", ["BENCHMARK_RATE_PCT", "BENCHMARK_RATE_DATE"])
def test_a_missing_rate_setting_is_503_not_a_guess(monkeypatch, missing):
    monkeypatch.delenv(missing)
    r = post(body())
    assert r.status_code == 503 and r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"
