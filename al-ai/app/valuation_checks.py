"""The numbers the valuation agent explains but cannot change: price gap, "price needs review" flag and two LTVs.

Plain maths on the unrounded estimate; rounding is for display only. The estimate, the threshold and the warnings come
from app.valuation_model and the valuation endpoint, so this module never loads the model.
"""

import math
from dataclasses import dataclass

LTV_LIMIT = 0.90  # Central Bank of Ireland: up to 90% for all buyers. Exactly 90% is within the limit.


@dataclass(frozen=True)
class ValuationChecks:
    price_gap: float | None  # asking price / estimate - 1; None when there is no asking price (a HELOC)
    needs_review: bool | None  # gap strictly above the calibrated threshold
    purchase_ltv: float | None  # loan / asking price
    purchase_ltv_within_limit: bool | None
    model_ltv: float  # loan / the lower of the asking price and the estimate: indicative, the model is not a legal valuation
    model_ltv_within_limit: bool
    support_warnings: tuple[str, ...]  # passed through from the valuation, never changed here


def _positive(value: float, name: str) -> float:
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive number")
    return value


def check_valuation(
    estimate: float, loan: float, asking_price: float | None, review_threshold: float, support_warnings: tuple[str, ...] = ()
) -> ValuationChecks:
    _positive(estimate, "estimate")
    _positive(loan, "loan")
    if asking_price is not None:
        _positive(asking_price, "asking_price")
    if asking_price is None:
        gap = flag = purchase_ltv = purchase_ok = None
        cautious_value = estimate
    else:
        gap = asking_price / estimate - 1
        flag = gap > review_threshold  # equal does not trigger
        purchase_ltv = loan / asking_price
        purchase_ok = purchase_ltv <= LTV_LIMIT
        cautious_value = min(asking_price, estimate)
    model_ltv = loan / cautious_value
    return ValuationChecks(
        price_gap=gap, needs_review=flag, purchase_ltv=purchase_ltv, purchase_ltv_within_limit=purchase_ok,
        model_ltv=model_ltv, model_ltv_within_limit=model_ltv <= LTV_LIMIT, support_warnings=tuple(support_warnings),
    )
