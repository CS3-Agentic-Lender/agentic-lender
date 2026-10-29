"""The policy gate: code, not the AI, stops a plain Approve on a loan that breaks a Central Bank limit.

It runs after the strategist. The caps themselves live in app.affordability; this module only applies them.
A breach never makes a recommendation more favourable, and never turns a Decline into anything else.
The LTV limit is judged on the purchase price, never on our model's estimate: the estimate is not a legal valuation.
"""

import math
from dataclasses import dataclass

from app import affordability as aff

LTI_CAP = "LTI_CAP"  # rule IDs, saved with the run so the underwriter sees which limit was broken
LTV_CAP = "LTV_CAP"  # a purchase: loan over 90% of the asking price
CLTV_CAP = "CLTV_CAP"  # a HELOC: owed plus the line over 80% of the home's value
RULE_IDS = (LTI_CAP, LTV_CAP, CLTV_CAP)

EXCEPTION_CONDITION = "Requires lender exception review"

APPROVE = "Approve"
CONDITIONAL = "Conditionally Approve"
DECLINE = "Decline"
RECOMMENDATIONS = (APPROVE, CONDITIONAL, DECLINE)


@dataclass(frozen=True)
class GateResult:
    original: str  # what the strategist recommended
    effective: str  # what the underwriter is shown as the recommendation
    conditions: tuple[str, ...]  # the strategist's conditions plus one per breach (none for a Decline)
    breaches: tuple[str, ...]  # rule IDs, always recorded, even for a Decline
    changed: bool  # the recommendation or its conditions differ from what the strategist wrote


def _positive(value: float, name: str) -> float:
    if value is None or not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive number")
    return value


def purchase_breaches(*, loan: float, gross_annual_income: float, first_time_buyer: bool, asking_price: float) -> tuple[str, ...]:
    """Rule IDs a home purchase breaks: loan to income over the cap, then loan to the asking price over 90%. Exactly on a limit is fine."""
    _positive(asking_price, "asking_price")
    found = []
    if aff.exceeds_lti_cap(loan, gross_annual_income, first_time_buyer):
        found.append(LTI_CAP)
    if loan / asking_price > aff.LTV_CAP:
        found.append(LTV_CAP)
    return tuple(found)


def heloc_breaches(*, existing_balance: float, line: float, home_value: float) -> tuple[str, ...]:
    """A HELOC has no income rule here and no asking price: what is owed plus the line, over the home's value, against 80%."""
    if aff.combined_ltv(existing_balance, line, home_value) > aff.HELOC_LTV_CAP:
        return (CLTV_CAP,)
    return ()


def apply_policy_gate(recommendation: str, conditions, breaches) -> GateResult:
    """Approve with a breach becomes Conditionally Approve. Every breach adds a condition. Decline stays Decline."""
    if recommendation not in RECOMMENDATIONS:
        raise ValueError(f"recommendation must be one of {list(RECOMMENDATIONS)}")
    unknown = [rule for rule in breaches if rule not in RULE_IDS]
    if unknown:
        raise ValueError(f"unknown rule ID {unknown[0]!r}, expected one of {list(RULE_IDS)}")
    breaches = tuple(breaches)
    kept = tuple(conditions)

    if recommendation == DECLINE:
        return GateResult(recommendation, DECLINE, (), breaches, changed=bool(kept))  # a declined loan carries no conditions

    effective = recommendation
    added = tuple(
        text for text in (f"{EXCEPTION_CONDITION} ({rule})" for rule in breaches) if text not in kept
    )
    if breaches and recommendation == APPROVE:
        effective = CONDITIONAL
    return GateResult(recommendation, effective, kept + added, breaches, changed=effective != recommendation or bool(added))
