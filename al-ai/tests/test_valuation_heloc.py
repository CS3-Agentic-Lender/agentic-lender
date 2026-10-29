"""/ai/valuation for a HELOC: the estimate and its warnings, plus combined LTV, and never a price gap."""

import pytest
from fastapi.testclient import TestClient

from app import auth, valuation_model
from app.main import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer ok"}


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": "borrower"})


@pytest.fixture
def controlled_estimate(monkeypatch):
    """The model answers EUR 400,000 for everything, so combined LTV is easy to check by hand."""
    monkeypatch.setattr(valuation_model, "estimate_value", lambda *a, **k: 400_000.0)


HOME = {"county": "Dublin", "floor_area_m2": 100, "bedrooms": 3, "property_type": "Terrace", "ber": "C1", "eircode": "D14 AK12"}


def heloc(**changes):
    return {**HOME, "loan_type": "heloc", "existing_mortgage_balance_eur": 200_000, "loan_amount_eur": 100_000, **changes}


def post(payload):
    return client.post("/ai/valuation", json=payload, headers=AUTH)


def test_a_heloc_below_the_cap_gets_its_combined_ltv_and_no_price_gap(controlled_estimate):
    j = post(heloc()).json()
    assert j["estimate_eur"] == 400_000 and j["combined_ltv"] == 0.75  # (200,000 + 100,000) / 400,000
    assert j["asking_price_gap"] is None and j["price_needs_review"] is None
    assert isinstance(j["support_warnings"], list)


def test_a_heloc_above_the_cap_gets_its_combined_ltv_too(controlled_estimate):
    j = post(heloc(loan_amount_eur=130_000)).json()
    assert j["combined_ltv"] == 0.825  # over 80%: the endpoint reports it, the policy gate judges it


def test_a_heloc_with_nothing_owed_is_just_the_line_over_the_estimate(controlled_estimate):
    assert post(heloc(existing_mortgage_balance_eur=0)).json()["combined_ltv"] == 0.25


def test_a_heloc_never_takes_an_asking_price():
    r = post(heloc(asking_price_eur=450_000))
    assert r.status_code == 422 and "asking_price_eur" in r.text


@pytest.mark.parametrize("missing", ["existing_mortgage_balance_eur", "loan_amount_eur"])
def test_a_heloc_needs_the_balance_and_the_credit_limit(missing):
    payload = heloc()
    del payload[missing]
    r = post(payload)
    assert r.status_code == 422 and missing in r.text


@pytest.mark.parametrize("field,value", [("existing_mortgage_balance_eur", -1), ("loan_amount_eur", 0), ("loan_amount_eur", "inf")])
def test_a_negative_zero_or_non_finite_amount_is_refused(field, value):
    assert post(heloc(**{field: value})).status_code == 422


def test_the_value_comes_from_the_house_details_never_from_a_number_the_client_sends():
    assert post(heloc(estimate_eur=900_000)).status_code == 422
    assert post(heloc(home_value_eur=900_000)).status_code == 422


@pytest.mark.parametrize("field", ["existing_mortgage_balance_eur", "loan_amount_eur"])
def test_a_purchase_does_not_take_the_heloc_amounts(field):
    r = post({**HOME, field: 100_000})
    assert r.status_code == 422 and field in r.text


def test_a_purchase_is_unchanged_and_has_no_combined_ltv(controlled_estimate):
    plain = post({**HOME, "asking_price_eur": 440_000}).json()
    named = post({**HOME, "loan_type": "mortgage", "asking_price_eur": 440_000}).json()
    assert plain == named
    assert plain["combined_ltv"] is None and plain["asking_price_gap"] == pytest.approx(0.1)


def test_an_unknown_loan_type_is_refused():
    assert post({**HOME, "loan_type": "bridging"}).status_code == 422
