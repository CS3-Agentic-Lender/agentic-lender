"""The numbers the valuation agent explains but cannot change: price gap, review flag and the two LTVs."""

import pytest

from app.valuation_checks import LTV_LIMIT, check_valuation

THRESHOLD = 0.25  # a round number, so a gap can land on it exactly


def check(estimate=400_000, loan=300_000, asking=None, warnings=(), threshold=THRESHOLD):
    return check_valuation(estimate=estimate, loan=loan, asking_price=asking, review_threshold=threshold, support_warnings=warnings)


# ---- gap and review flag -----------------------------------------------------------------

def test_the_gap_is_signed_asking_over_estimate_minus_one():
    assert check(asking=440_000).price_gap == pytest.approx(0.10)
    assert check(asking=320_000).price_gap == pytest.approx(-0.20)


def test_a_gap_exactly_at_the_threshold_does_not_trigger_review():
    c = check(estimate=400_000, asking=500_000)  # gap is exactly 0.25
    assert c.price_gap == THRESHOLD and c.needs_review is False


def test_a_gap_just_above_the_threshold_triggers_review():
    assert check(estimate=400_000, asking=500_001).needs_review is True


def test_an_asking_price_below_the_estimate_is_never_flagged():
    c = check(asking=300_000)
    assert c.price_gap < 0 and c.needs_review is False


def test_with_no_asking_price_the_gap_and_flag_are_empty():
    c = check(asking=None)
    assert c.price_gap is None and c.needs_review is None and c.purchase_ltv is None and c.purchase_ltv_within_limit is None


# ---- LTVs ---------------------------------------------------------------------------------

def test_purchase_price_ltv_is_loan_over_asking_price():
    assert check(loan=270_000, asking=300_000).purchase_ltv == pytest.approx(0.9)


def test_model_ltv_uses_the_lower_of_asking_price_and_estimate():
    assert check(loan=300_000, estimate=400_000, asking=500_000).model_ltv == pytest.approx(0.75)  # estimate is lower
    assert check(loan=300_000, estimate=400_000, asking=320_000).model_ltv == pytest.approx(300_000 / 320_000)  # asking is lower


def test_with_no_asking_price_the_model_ltv_uses_the_estimate():
    assert check(loan=300_000, estimate=400_000).model_ltv == pytest.approx(0.75)


def test_an_ltv_of_exactly_90_percent_is_within_the_limit():
    c = check(loan=270_000, estimate=300_000, asking=300_000)
    assert LTV_LIMIT == 0.90
    assert c.purchase_ltv == 0.9 and c.purchase_ltv_within_limit is True
    assert c.model_ltv == 0.9 and c.model_ltv_within_limit is True


def test_an_ltv_just_above_90_percent_is_over_the_limit():
    c = check(loan=270_001, estimate=300_000, asking=300_000)
    assert c.purchase_ltv_within_limit is False and c.model_ltv_within_limit is False


def test_the_two_ltvs_can_disagree():
    c = check(loan=270_000, estimate=250_000, asking=300_000)  # fine on price, over the limit on the cautious value
    assert c.purchase_ltv_within_limit is True and c.model_ltv_within_limit is False


# ---- rounding and warnings ----------------------------------------------------------------

def test_the_maths_uses_the_unrounded_estimate():
    c = check(estimate=399_999.6, asking=400_000)
    assert c.price_gap == pytest.approx(400_000 / 399_999.6 - 1) and c.price_gap > 0  # a rounded estimate would give exactly 0


def test_support_warnings_are_passed_through_unchanged():
    warnings = ("The model has not seen Eircode area Z99.",)
    assert check(warnings=warnings).support_warnings == warnings


# ---- bad input is refused, never guessed ------------------------------------------------------

@pytest.mark.parametrize("changes", [{"estimate": 0}, {"estimate": -1}, {"loan": 0}, {"loan": -5}, {"asking": 0}, {"asking": -1}])
def test_a_zero_or_negative_amount_is_refused(changes):
    with pytest.raises(ValueError):
        check(**changes)


@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_nan_and_infinity_are_refused(bad):
    with pytest.raises(ValueError):
        check(estimate=bad)
