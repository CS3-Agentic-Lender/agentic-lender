"""POST /ai/affordability: how much a borrower can borrow. The maths lives in app.affordability."""

import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StrictBool

from app import affordability, auth

router = APIRouter(prefix="/ai")


class AffordabilityRequest(BaseModel):
    # Bounds match the iOS form: income up to EUR 10m, term 5 to 35 years. Incomes and debts are household totals.
    gross_income_eur: float = Field(gt=0, le=10_000_000)
    monthly_debts_eur: float = Field(ge=0)
    deposit_eur: float = Field(ge=0)
    term_years: int = Field(ge=5, le=35)
    first_time_buyer: StrictBool


class AffordabilityResponse(BaseModel):
    max_loan_eur: float
    max_property_price_eur: float
    monthly_repayment_eur: float
    stressed_repayment_eur: float
    limited_by: Literal["income", "deposit", "debts"]
    benchmark_rate_pct: float
    stressed_rate_pct: float
    rate_date: str  # YYYY-MM


def benchmark_rate() -> tuple[float, str]:
    """The benchmark mortgage rate in percent and the month it is from.

    ponytail: read from settings until the ECB rate tool exists. Never guessed: missing or unreadable is a 503.
    """
    pct, month = os.getenv("BENCHMARK_RATE_PCT"), os.getenv("BENCHMARK_RATE_DATE")
    try:
        if pct and month:
            return float(pct), month
    except ValueError:
        pass
    raise HTTPException(503, "The benchmark mortgage rate is not available")


@router.post("/affordability")
def calculate(request: AffordabilityRequest, user: dict = Depends(auth.current_user)) -> AffordabilityResponse:
    rate_pct, rate_date = benchmark_rate()
    c = affordability.borrowing_capacity(
        request.gross_income_eur,
        request.monthly_debts_eur,
        request.deposit_eur,
        rate_pct / 100,
        request.term_years,
        request.first_time_buyer,
    )
    return AffordabilityResponse(
        max_loan_eur=round(c.max_loan, 2),  # cents, so float noise like 270000.00000000006 never leaves the API
        max_property_price_eur=round(c.max_property_price, 2),
        monthly_repayment_eur=round(c.repayment, 2),
        stressed_repayment_eur=round(c.stressed_repayment, 2),
        limited_by=c.limited_by,
        benchmark_rate_pct=rate_pct,
        stressed_rate_pct=round(rate_pct + affordability.STRESS_MARGIN * 100, 6),
        rate_date=rate_date,
    )
