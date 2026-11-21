"""The house price fall over the active portfolio (AL-69): how many loans end up above 80% and above 90% LTV if home values drop.

This module only does the maths and does no I/O: portfolio_endpoint.py loads the applications and hands them in, as it does for the
rate shock (AL-68). The loan to value is the indicative, model-based one, never a verified valuation.

What a loan is measured against (the starting value):
  mortgage  the lower of the asking price and the model's estimate, the figure the loan file and the valuation check use
            (valuation_checks.check_valuation). With no estimate yet, the asking price.
  HELOC     the model's estimate. A HELOC has no asking price, so with no estimate yet there is no value to use: it is skipped.
The loan is the requested amount for a mortgage, and the existing mortgage balance plus the requested limit for a HELOC (the
combined LTV, affordability.combined_ltv).

"Before" is the loan against the starting value (a fall of 0). "After" is the same loan against the starting value x (1 - fall).
A loan is "above 80" when its LTV is over 80% and "above 90" when it is over 90%: exactly 80 or exactly 90 is not above, as
valuation_checks.LTV_LIMIT treats exactly 90 as within the limit. Above 90 is always part of above 80.
"""

import math
from dataclasses import dataclass

from app import affordability, valuation_checks
from app.rate_shock import ACTIVE_STATUSES  # the same four statuses, so the two portfolio checks cover the same applications

__all__ = ["ACTIVE_STATUSES", "FALL_MIN_PCT", "FALL_MAX_PCT", "FALL_STEP_PCT", "Loan", "starting_value", "run"]

FALL_MIN_PCT, FALL_MAX_PCT, FALL_STEP_PCT = 0, 40, 5
OVER_80 = 0.80
OVER_90 = valuation_checks.LTV_LIMIT
NOTE = "An indicative, model-based loan to value. It is not a verified valuation."


@dataclass(frozen=True)
class Loan:
    application_id: str
    loan_type: str  # "mortgage" or "heloc"
    loan_eur: float  # a mortgage's loan, or a HELOC's requested credit limit
    existing_mortgage_balance_eur: float | None  # HELOC only
    asking_price_eur: float | None  # mortgage only
    estimate_eur: float | None  # the model's estimate, once there is one


def _number(value, label: str, *, positive: bool) -> float:
    """A real number, above zero when `positive`, otherwise zero or more. A missing, text, boolean or non-finite value is refused."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} is missing or is not a number")
    if value <= 0 if positive else value < 0:
        raise ValueError(f"{label} must be {'above' if positive else 'at least'} zero")
    return float(value)


def starting_value(loan: Loan) -> tuple[float, str]:
    """The value the loan is measured against and where it came from: ("asking_price" or "model_estimate"). ValueError when there is none."""
    if loan.loan_type not in ("mortgage", "heloc"):
        raise ValueError("the loan type is neither mortgage nor HELOC")
    has_estimate = loan.estimate_eur is not None
    estimate = _number(loan.estimate_eur, "the model's estimate", positive=True) if has_estimate else None
    if loan.loan_type == "heloc":
        if estimate is None:
            raise ValueError("a HELOC is measured against the model's estimate, and this one has no estimate yet")
        return estimate, "model_estimate"
    asking = _number(loan.asking_price_eur, "the asking price", positive=True)
    if estimate is not None and estimate < asking:
        return estimate, "model_estimate"
    return asking, "asking_price"


def _loan_amount(loan: Loan) -> float:
    """The mortgage's loan, or a HELOC's existing balance plus its limit (the combined loan)."""
    line = _number(loan.loan_eur, "the loan amount", positive=True)
    if loan.loan_type == "heloc":
        return _number(loan.existing_mortgage_balance_eur, "the existing mortgage balance", positive=False) + line
    return line


def _ltv(loan: Loan, value: float) -> float:
    """Call after _loan_amount has checked the figures. A HELOC's is the combined LTV, a mortgage's is the loan over the value."""
    if loan.loan_type == "heloc":
        return affordability.combined_ltv(loan.existing_mortgage_balance_eur, loan.loan_eur, value)
    return loan.loan_eur / value


def _flags(ltv: float) -> dict:
    return {"above_80": ltv > OVER_80, "above_90": ltv > OVER_90}


def _result(loan: Loan, fall_pct: int) -> dict:
    value, basis = starting_value(loan)
    amount = _loan_amount(loan)
    new_value = value * (100 - fall_pct) / 100  # not value * (1 - fall_pct / 100): that is inexact and tips a loan on exactly 80% or 90% over the line
    before, after = _ltv(loan, value), _ltv(loan, new_value)
    return {
        "application_id": loan.application_id,
        "loan_type": loan.loan_type,
        "value_basis": basis,
        "loan_eur": round(amount, 2),
        "starting_value_eur": round(value, 2),
        "before": {"ltv_pct": round(before * 100, 2), **_flags(before)},
        "after": {"property_value_eur": round(new_value, 2), "ltv_pct": round(after * 100, 2), **_flags(after)},
        "_amount": amount,
    }


def _above(results: list[dict], when: str, flag: str) -> dict:
    hit = [r for r in results if r[when][flag]]
    return {"count": len(hit), "loan_eur": round(sum(r["_amount"] for r in hit), 2)}


def run(loans: list[Loan], fall_pct: int) -> dict:
    """The per-application results and the portfolio totals. A loan whose figures the maths refuses is skipped and listed, not guessed."""
    if isinstance(fall_pct, bool) or not isinstance(fall_pct, int) or not FALL_MIN_PCT <= fall_pct <= FALL_MAX_PCT or fall_pct % FALL_STEP_PCT:
        raise ValueError(f"the fall must be a whole number of percent from {FALL_MIN_PCT} to {FALL_MAX_PCT} in steps of {FALL_STEP_PCT}")
    results, skipped = [], []
    for loan in loans:
        try:
            results.append(_result(loan, fall_pct))
        except ValueError as exc:
            skipped.append({"application_id": loan.application_id, "reason": str(exc)})
    totals = {
        "count": len(results),
        **{when: {flag: _above(results, when, flag) for flag in ("above_80", "above_90")} for when in ("before", "after")},
    }
    for r in results:
        del r["_amount"]
    return {"fall_pct": fall_pct, "note": NOTE, "applications": results, "totals": totals, "skipped": skipped}
