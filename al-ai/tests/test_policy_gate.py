"""The policy gate: code, not the AI, stops a plain Approve on a loan that breaks a Central Bank limit."""

import inspect

import pytest

from app import policy_gate as gate
from app.policy_gate import CLTV_CAP, LTI_CAP, LTV_CAP, apply_policy_gate, heloc_breaches, purchase_breaches

EXCEPTION = "Requires lender exception review"


def buy(loan=240_000, income=60_000, first_time=True, asking=300_000):
    return purchase_breaches(loan=loan, gross_annual_income=income, first_time_buyer=first_time, asking_price=asking)


# ---- finding the breaches (purchase) -------------------------------------------------------

def test_a_loan_inside_both_limits_has_no_breach():
    assert buy() == ()  # 4.0x income and exactly 80% of the price


def test_lti_exactly_at_the_cap_is_not_a_breach_and_just_over_is():
    assert buy(loan=240_000, income=60_000, first_time=True, asking=1_000_000) == ()
    assert buy(loan=240_001, income=60_000, first_time=True, asking=1_000_000) == (LTI_CAP,)


def test_the_cap_is_lower_for_a_buyer_who_is_not_a_first_time_buyer():
    assert buy(loan=210_000, income=60_000, first_time=False, asking=1_000_000) == ()  # exactly 3.5x
    assert buy(loan=210_001, income=60_000, first_time=False, asking=1_000_000) == (LTI_CAP,)


def test_purchase_ltv_exactly_at_90_percent_is_not_a_breach_and_just_over_is():
    assert buy(loan=270_000, income=200_000, asking=300_000) == ()
    assert buy(loan=270_001, income=200_000, asking=300_000) == (LTV_CAP,)


def test_the_ltv_uses_the_asking_price_and_never_the_model_estimate():
    # No estimate is even an input: the legal limit cannot rest on our model.
    assert set(inspect.signature(purchase_breaches).parameters) == {"loan", "gross_annual_income", "first_time_buyer", "asking_price"}


def test_a_loan_over_both_limits_reports_both_in_a_fixed_order():
    assert buy(loan=300_000, income=60_000, asking=300_000) == (LTI_CAP, LTV_CAP)


@pytest.mark.parametrize("bad", [0, -1, float("nan"), float("inf")])
def test_a_zero_negative_or_non_finite_amount_is_refused(bad):
    with pytest.raises(ValueError):
        buy(income=bad)
    with pytest.raises(ValueError):
        buy(asking=bad)


# ---- finding the breaches (HELOC) ----------------------------------------------------------

def test_a_heloc_is_checked_on_combined_ltv_against_80_percent_and_has_no_lti_rule():
    assert heloc_breaches(existing_balance=100_000, line=140_000, home_value=300_000) == ()  # exactly 80%
    assert heloc_breaches(existing_balance=100_000, line=140_001, home_value=300_000) == (CLTV_CAP,)


def test_a_heloc_with_no_line_but_a_balance_over_the_limit_is_still_a_breach():
    assert heloc_breaches(existing_balance=250_000, line=0, home_value=300_000) == (CLTV_CAP,)


def test_the_heloc_rule_has_its_own_id_so_it_is_never_confused_with_the_purchase_ltv_cap():
    assert CLTV_CAP == "CLTV_CAP" and CLTV_CAP != LTV_CAP
    r = apply_policy_gate("Approve", [], (CLTV_CAP,))
    assert r.effective == "Conditionally Approve" and r.conditions == (f"{EXCEPTION} ({CLTV_CAP})",)


# ---- applying the gate: all three starting recommendations, with and without a breach ------

def test_approve_with_no_breach_is_left_alone():
    r = apply_policy_gate("Approve", [], ())
    assert (r.original, r.effective, r.conditions, r.breaches, r.changed) == ("Approve", "Approve", (), (), False)


def test_approve_with_a_breach_becomes_conditionally_approve_with_the_exception_condition():
    r = apply_policy_gate("Approve", [], (LTI_CAP,))
    assert r.original == "Approve" and r.effective == "Conditionally Approve" and r.changed is True
    assert r.conditions == (f"{EXCEPTION} ({LTI_CAP})",)
    assert r.breaches == (LTI_CAP,)


def test_conditionally_approve_with_no_breach_keeps_its_conditions_exactly():
    r = apply_policy_gate("Conditionally Approve", ["Independent valuation"], ())
    assert r.effective == "Conditionally Approve" and r.conditions == ("Independent valuation",) and r.changed is False


def test_conditionally_approve_with_a_breach_keeps_its_conditions_and_adds_the_new_one():
    r = apply_policy_gate("Conditionally Approve", ["Independent valuation"], (LTV_CAP,))
    assert r.original == r.effective == "Conditionally Approve"
    assert r.conditions == ("Independent valuation", f"{EXCEPTION} ({LTV_CAP})")
    assert r.changed is True  # the conditions changed, so the underwriter is told


def test_every_breach_adds_its_own_condition():
    r = apply_policy_gate("Approve", [], (LTI_CAP, LTV_CAP))
    assert r.conditions == (f"{EXCEPTION} ({LTI_CAP})", f"{EXCEPTION} ({LTV_CAP})")


def test_decline_with_no_breach_is_left_alone():
    r = apply_policy_gate("Decline", [], ())
    assert r.effective == "Decline" and r.changed is False


def test_decline_with_a_breach_stays_decline_and_the_breach_is_recorded():
    r = apply_policy_gate("Decline", [], (LTI_CAP, LTV_CAP))
    assert r.original == r.effective == "Decline"
    assert r.breaches == (LTI_CAP, LTV_CAP)
    assert r.conditions == ()  # a declined loan carries no conditions


def test_a_decline_that_loses_the_strategists_conditions_counts_as_changed():
    r = apply_policy_gate("Decline", ["Independent valuation"], ())
    assert r.conditions == () and r.changed is True


def test_a_condition_the_strategist_already_wrote_is_not_added_twice():
    already = f"{EXCEPTION} ({LTI_CAP})"
    r = apply_policy_gate("Conditionally Approve", [already], (LTI_CAP,))
    assert r.conditions == (already,)


def test_the_gate_never_makes_a_recommendation_more_favourable():
    for start in ("Approve", "Conditionally Approve", "Decline"):
        for breaches in ((), (LTI_CAP,), (LTI_CAP, LTV_CAP)):
            order = ["Decline", "Conditionally Approve", "Approve"]
            assert order.index(apply_policy_gate(start, [], breaches).effective) <= order.index(start)


def test_the_inputs_are_not_changed():
    conditions = ["Independent valuation"]
    apply_policy_gate("Approve", conditions, (LTI_CAP,))
    assert conditions == ["Independent valuation"]


@pytest.mark.parametrize("bad", ["approve", "Reject", "", None])
def test_an_unknown_recommendation_is_refused(bad):
    with pytest.raises(ValueError):
        apply_policy_gate(bad, [], ())


def test_an_unknown_rule_id_is_refused():
    with pytest.raises(ValueError):
        apply_policy_gate("Approve", [], ("MADE_UP",))


# ---- one place for each limit ----------------------------------------------------------------

def test_the_gate_holds_no_limits_of_its_own_so_it_cannot_drift_from_the_other_checks():
    from app import valuation_checks

    assert not any(name.endswith(("_LIMIT", "_CAP_FIRST_TIME", "_CAP_OTHER")) for name in vars(gate))
    assert aff_ltv() == valuation_checks.LTV_LIMIT  # the valuation agent and the gate use the same 90%


def aff_ltv():
    from app import affordability

    return affordability.LTV_CAP
