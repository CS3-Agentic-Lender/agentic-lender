"""The price gap and the "price needs review" flag are worked out in one place: valuation_checks.price_gap_check."""

import pytest
from fastapi.testclient import TestClient

from app import auth, valuation_checks, valuation_model
from app.main import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer ok"}
THRESHOLD = 0.25


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": "borrower"})


@pytest.fixture
def controlled_estimate(monkeypatch):
    """The model answers EUR 400,000 for everything and the threshold is a round 25%, so a gap can land on it exactly."""
    monkeypatch.setattr(valuation_model, "estimate_value", lambda *a, **k: 400_000.0)
    monkeypatch.setattr(valuation_model, "review_threshold", lambda: THRESHOLD)


def body(**changes):
    base = {"county": "Dublin", "floor_area_m2": 100, "bedrooms": 3, "property_type": "Terrace", "ber": "C1", "eircode": "D14 AB12"}
    return {**base, **changes}


def post(payload):
    return client.post("/ai/valuation", json=payload, headers=AUTH)


# ---- the helper ----------------------------------------------------------------------------

def test_the_gap_is_signed_asking_over_estimate_minus_one():
    assert valuation_checks.price_gap_check(400_000, 440_000, THRESHOLD)[0] == pytest.approx(0.10)
    assert valuation_checks.price_gap_check(400_000, 320_000, THRESHOLD)[0] == pytest.approx(-0.20)


def test_a_gap_exactly_at_the_threshold_does_not_trigger_review_and_just_above_does():
    assert valuation_checks.price_gap_check(400_000, 500_000, THRESHOLD) == (0.25, False)
    assert valuation_checks.price_gap_check(400_000, 500_001, THRESHOLD)[1] is True


def test_with_no_asking_price_there_is_no_gap_and_no_flag():
    assert valuation_checks.price_gap_check(400_000, None, THRESHOLD) == (None, None)


@pytest.mark.parametrize("estimate,asking", [(0, 1), (-1, 1), (float("nan"), 1), (1, 0), (1, -5), (1, float("inf"))])
def test_a_zero_negative_or_non_finite_amount_is_refused(estimate, asking):
    with pytest.raises(ValueError):
        valuation_checks.price_gap_check(estimate, asking, THRESHOLD)


# ---- the endpoint uses it, and so does check_valuation -------------------------------------------

def test_the_endpoint_takes_the_gap_and_the_flag_from_the_shared_function(monkeypatch):
    seen = []

    def fake(estimate, asking_price, review_threshold):
        seen.append((estimate, asking_price, review_threshold))
        return 0.123456789, True

    monkeypatch.setattr(valuation_checks, "price_gap_check", fake)
    j = post(body(asking_price_eur=300_000)).json()
    assert j["asking_price_gap"] == 0.123457 and j["price_needs_review"] is True  # rounded to 6 places for display
    assert len(seen) == 1 and seen[0][1] == 300_000


def test_check_valuation_takes_the_gap_and_the_flag_from_the_same_shared_function(monkeypatch):
    monkeypatch.setattr(valuation_checks, "price_gap_check", lambda *a: (0.5, True))
    c = valuation_checks.check_valuation(estimate=400_000, loan=300_000, asking_price=420_000, review_threshold=THRESHOLD)
    assert c.price_gap == 0.5 and c.needs_review is True


# ---- the endpoint still behaves exactly as before -------------------------------------------------

def test_through_the_endpoint_a_gap_exactly_at_the_threshold_does_not_trigger_review(controlled_estimate):
    j = post(body(asking_price_eur=500_000)).json()
    assert j["asking_price_gap"] == 0.25 and j["price_needs_review"] is False


def test_through_the_endpoint_a_gap_just_above_the_threshold_triggers_review(controlled_estimate):
    j = post(body(asking_price_eur=500_001)).json()
    assert j["asking_price_gap"] > 0.25 and j["price_needs_review"] is True


def test_through_the_endpoint_an_asking_price_below_the_estimate_is_a_negative_gap_and_no_flag(controlled_estimate):
    j = post(body(asking_price_eur=300_000)).json()
    assert j["asking_price_gap"] == -0.25 and j["price_needs_review"] is False


def test_through_the_endpoint_no_asking_price_means_no_gap_and_no_flag(controlled_estimate):
    j = post(body()).json()
    assert j["asking_price_gap"] is None and j["price_needs_review"] is None
