import json

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


@pytest.mark.parametrize("field", ["gross_income_eur", "monthly_debts_eur", "deposit_eur", "term_years"])
@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_nan_and_infinity_are_422_and_name_the_field(field, literal):
    # The test client won't write these into JSON, so send the raw text a real client could.
    text = json.dumps(body(**{field: "__X__"})).replace('"__X__"', literal)
    r = client.post("/ai/affordability", content=text, headers={**AUTH, "Content-Type": "application/json"})
    assert r.status_code == 422 and r.json()["error"]["field"] == field


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


# ---- HELOC: a credit line against a home the borrower owns ---------------------------------------

from app import valuation_model  # noqa: E402

HELOC_KEYS = {
    "home_value_eur", "max_line_eur", "combined_ltv", "monthly_repayment_eur", "stressed_repayment_eur",
    "limited_by", "benchmark_rate_pct", "stressed_rate_pct", "rate_date",
}


def heloc_body(**changes):
    base = {"loan_type": "heloc", "county": "Cork", "property_type": "Semi-D", "bedrooms": 3, "floor_area_m2": 110, "ber_rating": "B3",
            "existing_mortgage_balance_eur": 150_000, "gross_income_eur": 70_000, "monthly_debts_eur": 300, "term_years": 20}
    return {**base, **changes}


@pytest.fixture
def home_worth_300k(monkeypatch):
    seen = {}

    def fake(*args):
        seen["args"] = args
        return 300_000.0

    monkeypatch.setattr(valuation_model, "estimate_value", fake)
    return seen


def test_heloc_reference_case_uses_the_models_value(home_worth_300k):
    r = post(heloc_body())
    assert r.status_code == 200
    j = r.json()
    assert set(j) == HELOC_KEYS
    assert j["home_value_eur"] == 300_000 and j["max_line_eur"] == 90_000  # 80% of 300,000 minus 150,000
    assert j["limited_by"] == "equity" and j["combined_ltv"] == 0.8
    assert j["monthly_repayment_eur"] == 545.38 and j["stressed_repayment_eur"] == 644.79  # at the 4.00% test rate and +2 points
    assert j["benchmark_rate_pct"] == 4.0 and j["stressed_rate_pct"] == 6.0 and j["rate_date"] == "2026-08"
    assert home_worth_300k["args"] == ("Cork", "Semi-D", 3, 110, "B3", None)  # the five house details, no routing key


def test_heloc_with_no_equity_gives_a_zero_line_not_an_error(home_worth_300k):
    j = post(heloc_body(existing_mortgage_balance_eur=250_000)).json()
    assert j["max_line_eur"] == 0 and j["monthly_repayment_eur"] == 0 and j["limited_by"] == "equity"


def test_heloc_debts_do_not_change_the_line(home_worth_300k):
    assert post(heloc_body(monthly_debts_eur=0)).json()["max_line_eur"] == post(heloc_body(monthly_debts_eur=5_000)).json()["max_line_eur"]


def test_heloc_routing_key_is_passed_to_the_model_when_given(home_worth_300k):
    assert post(heloc_body(eircode_routing_key="T12")).status_code == 200
    assert home_worth_300k["args"][-1] == "T12"


def test_the_client_cannot_send_the_home_value(home_worth_300k):
    for field in ("home_value_eur", "property_value_eur", "asking_price_eur"):
        assert post(heloc_body(**{field: 900_000})).status_code == 422


@pytest.mark.parametrize("change", [
    {"county": "Atlantis"}, {"property_type": "Castle"}, {"ber_rating": "Z9"}, {"floor_area_m2": 14}, {"floor_area_m2": 1001},
    {"bedrooms": -1}, {"existing_mortgage_balance_eur": -1}, {"gross_income_eur": 0}, {"monthly_debts_eur": -1},
    {"term_years": 4}, {"term_years": 36}, {"eircode_routing_key": "12345"},
])
def test_heloc_refuses_bad_input(home_worth_300k, change):
    assert post(heloc_body(**change)).status_code == 422


@pytest.mark.parametrize("field", ["gross_income_eur", "monthly_debts_eur", "existing_mortgage_balance_eur", "floor_area_m2"])
@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_heloc_nan_and_infinity_are_422(home_worth_300k, field, literal):
    text = json.dumps(heloc_body(**{field: "__X__"})).replace('"__X__"', literal)  # the test client won't write these, so send raw text
    r = client.post("/ai/affordability", content=text, headers={**AUTH, "Content-Type": "application/json"})
    assert r.status_code == 422


def test_heloc_errors_name_the_field(home_worth_300k):
    r = post(heloc_body(county="Atlantis"))
    assert r.status_code == 422 and r.json()["error"]["field"] == "county"


def test_heloc_deposit_and_first_time_buyer_are_not_accepted(home_worth_300k):
    assert post(heloc_body(deposit_eur=1)).status_code == 422
    assert post(heloc_body(first_time_buyer=True)).status_code == 422


def test_heloc_needs_every_house_detail(home_worth_300k):
    for field in ("county", "property_type", "bedrooms", "floor_area_m2", "ber_rating", "existing_mortgage_balance_eur", "gross_income_eur", "term_years"):
        payload = heloc_body()
        del payload[field]
        assert post(payload).status_code == 422, field


def test_heloc_answers_503_when_the_model_cannot_be_used(monkeypatch):
    def broken(*args):
        raise valuation_model.ValuationUnavailable("no model")

    monkeypatch.setattr(valuation_model, "estimate_value", broken)
    assert post(heloc_body()).status_code == 503


def test_heloc_needs_a_signed_in_user(home_worth_300k):
    assert post(heloc_body(), headers={}).status_code == 401


def test_a_request_without_loan_type_is_still_a_mortgage():
    assert post(body()).status_code == 200
    assert post(body(loan_type="mortgage")).status_code == 200
    assert post(body(loan_type="car")).status_code == 422


def test_heloc_with_the_real_model_gives_a_plausible_value():
    j = post(heloc_body()).json()  # Cork semi-detached, 110 m2, B3: the ticket's example
    assert 150_000 < j["home_value_eur"] < 600_000
    assert j["max_line_eur"] == pytest.approx(max(0.0, 0.8 * j["home_value_eur"] - 150_000), abs=0.01)
