"""POST /ai/affordability: how much a borrower can borrow. The maths lives in app.affordability."""

import os
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Discriminator, Field, StrictBool, Tag

from app import affordability, auth, valuation_model
from ml import data_readiness as dr

router = APIRouter(prefix="/ai")


def _one_of(allowed, what):
    def check(value: str) -> str:
        if value not in allowed:
            raise ValueError(f"{what} must be one of: {', '.join(sorted(allowed))}")
        return value
    return AfterValidator(check)


BER_VALUES = {*dr.BER_BANDS, dr.BER_UNKNOWN}  # A to G, the old A1 to E3 subgrades, or Unknown


class AffordabilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")  # a stray field is refused, so a client cannot slip one in by mistake
    loan_type: Literal["mortgage"] = "mortgage"  # a request with no loan_type is a mortgage, as before
    # Bounds match the iOS form: income up to EUR 10m, term 5 to 35 years. Incomes and debts are household totals.
    # allow_inf_nan=False: NaN and Infinity pass a plain >= 0 check, so they are refused outright.
    gross_income_eur: float = Field(gt=0, le=10_000_000, allow_inf_nan=False)
    monthly_debts_eur: float = Field(ge=0, allow_inf_nan=False)
    deposit_eur: float = Field(ge=0, allow_inf_nan=False)
    term_years: int = Field(ge=5, le=35)
    first_time_buyer: StrictBool


class HelocRequest(BaseModel):
    """A credit line against a home the borrower owns. The value of the home is never sent: it comes from the valuation model."""
    model_config = ConfigDict(extra="forbid")
    loan_type: Literal["heloc"]
    county: Annotated[str, _one_of(dr.REPUBLIC_COUNTIES, "county")]
    property_type: Annotated[str, _one_of(dr.SUPPORTED_TYPES, "property_type")]
    bedrooms: int = Field(ge=0, le=30)
    floor_area_m2: float = Field(ge=15, le=1000, allow_inf_nan=False)  # the range the model was trained on
    ber_rating: Annotated[str, _one_of(BER_VALUES, "ber_rating")]
    eircode_routing_key: str | None = Field(default=None, pattern=r"^[A-Za-z]\d{2}$|^D6W$")  # optional: first 3 characters, e.g. D14
    existing_mortgage_balance_eur: float = Field(ge=0, le=100_000_000, allow_inf_nan=False)
    gross_income_eur: float = Field(gt=0, le=10_000_000, allow_inf_nan=False)  # one household total
    monthly_debts_eur: float = Field(ge=0, allow_inf_nan=False)  # accepted for the form; the credit committee judges debts, not this number
    term_years: int = Field(ge=5, le=35)


class HelocResponse(BaseModel):
    home_value_eur: float  # the model's indicative 2024 asking-price estimate
    max_line_eur: float
    combined_ltv: float
    monthly_repayment_eur: float  # the line fully drawn, at the benchmark rate
    stressed_repayment_eur: float  # the same, at the benchmark rate plus 2 points
    limited_by: Literal["equity"]
    benchmark_rate_pct: float
    stressed_rate_pct: float
    rate_date: str  # YYYY-MM


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


def _loan_type(value) -> str:
    """Pick the request model from loan_type, so an error names the field in the right one. No loan_type means a mortgage."""
    chosen = value.get("loan_type") if isinstance(value, dict) else getattr(value, "loan_type", None)
    return "heloc" if chosen == "heloc" else "mortgage"


AnyAffordabilityRequest = Annotated[
    Annotated[AffordabilityRequest, Tag("mortgage")] | Annotated[HelocRequest, Tag("heloc")], Discriminator(_loan_type)
]


@router.post("/affordability")
def calculate(
    request: Annotated[AnyAffordabilityRequest, Body()], user: dict = Depends(auth.current_user)
) -> AffordabilityResponse | HelocResponse:
    rate_pct, rate_date = benchmark_rate()
    if isinstance(request, HelocRequest):
        return heloc(request, rate_pct, rate_date)
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


def heloc(request: HelocRequest, rate_pct: float, rate_date: str) -> HelocResponse:
    try:
        value = valuation_model.estimate_value(
            request.county, request.property_type, request.bedrooms, request.floor_area_m2, request.ber_rating, request.eircode_routing_key
        )
    except valuation_model.ValuationUnavailable:
        raise HTTPException(503, "The home valuation is not available")
    c = affordability.heloc_capacity(value, request.existing_mortgage_balance_eur, rate_pct / 100, request.term_years)
    return HelocResponse(
        home_value_eur=round(value, 2),
        max_line_eur=round(c.max_line, 2),
        combined_ltv=round(c.combined_ltv, 6),
        monthly_repayment_eur=round(c.repayment, 2),
        stressed_repayment_eur=round(c.stressed_repayment, 2),
        limited_by=c.limited_by,
        benchmark_rate_pct=rate_pct,
        stressed_rate_pct=round(rate_pct + affordability.STRESS_MARGIN * 100, 6),
        rate_date=rate_date,
    )
