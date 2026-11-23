"""The portfolio checks, each over every active application, for underwriters only.

POST /ai/portfolio/rate-shock  the rate shock (AL-68). The maths lives in app.rate_shock.
POST /ai/portfolio/downturn    the house price fall (AL-69). The maths lives in app.house_price_fall.
"""

import os

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from app import affordability_endpoint, auth, house_price_fall, rate_shock
from app.rate_shock import Loan

router = APIRouter(prefix="/ai")

_client = None


class RateShockRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shock_bps: StrictInt = Field(ge=rate_shock.SHOCK_MIN_BPS, le=rate_shock.SHOCK_MAX_BPS)  # 100 basis points is 1 percentage point

    @field_validator("shock_bps")
    @classmethod
    def _in_steps(cls, value: int) -> int:
        if value % rate_shock.SHOCK_STEP_BPS:
            raise ValueError(f"must be a multiple of {rate_shock.SHOCK_STEP_BPS}")
        return value


def require_underwriter(user: dict = Depends(auth.current_user)) -> dict:
    if user.get("role") != "underwriter":
        raise HTTPException(403, "Only an underwriter can run a portfolio check")
    return user


def _db():
    global _client
    if _client is None:
        from google.cloud import firestore

        _client = firestore.Client(project=os.getenv("FIREBASE_PROJECT_ID", "demo-al"))
    return _client


def _active_applications() -> dict[str, dict]:
    """The active applications by id, one read however many there are."""
    from google.cloud.firestore_v1.base_query import FieldFilter

    return {
        doc.id: doc.to_dict()
        for doc in _db().collection("applications").where(filter=FieldFilter("status", "in", list(rate_shock.ACTIVE_STATUSES))).stream()
    }


def load_active_applications() -> list[dict]:
    """The active applications, each with its id."""
    return [{"id": app_id, **fields} for app_id, fields in _active_applications().items()]


def load_portfolio() -> tuple[list[dict], dict[str, float]]:
    """The active applications (id and fields) and the stored benchmark rate of each that has one. Two reads however many applications there are."""
    db = _db()
    apps = _active_applications()
    rates = {}
    for review in db.collection_group("review").stream():
        if review.id != "underwriting" or review.reference.parent.parent is None:
            continue
        app_id = review.reference.parent.parent.id
        pct = ((review.to_dict() or {}).get("dtiBreakdown") or {}).get("benchmarkRatePct")
        if app_id in apps and isinstance(pct, (int, float)):
            rates[app_id] = float(pct)
    return [{"id": app_id, **fields} for app_id, fields in apps.items()], rates


def _loan(doc: dict, stored: dict[str, float], current: float | None) -> Loan:
    pct, source = (stored[doc["id"]], "stored") if doc["id"] in stored else (current, "current")
    return Loan(
        application_id=doc["id"],
        loan_eur=doc.get("loanAmountEur"),
        term_years=doc.get("termYears"),
        gross_income_eur=doc.get("grossIncomeEur"),
        take_home_monthly_eur=doc.get("monthlyTakeHomeEur"),
        debts_monthly_eur=doc.get("monthlyDebtsEur"),
        living_costs_monthly_eur=doc.get("monthlyLivingCostsEur"),
        benchmark_rate_pct=pct,
        rate_source=source,
    )


@router.post("/portfolio/rate-shock")
def rate_shock_run(request: RateShockRequest = Body(), user: dict = Depends(require_underwriter)) -> dict:
    docs, stored = load_portfolio()
    # An application the committee has not run yet has no stored rate, so it is priced at today's ECB rate and says so. The rate is
    # fetched only when one is needed, and never guessed: when it is unavailable the whole run is a 503.
    current = affordability_endpoint.benchmark_rate()[0] if any(d["id"] not in stored for d in docs) else None
    return rate_shock.run([_loan(d, stored, current) for d in docs], request.shock_bps)


class HousePriceFallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fall_pct: StrictInt = Field(ge=house_price_fall.FALL_MIN_PCT, le=house_price_fall.FALL_MAX_PCT)  # percent of the home's value

    @field_validator("fall_pct")
    @classmethod
    def _in_steps(cls, value: int) -> int:
        if value % house_price_fall.FALL_STEP_PCT:
            raise ValueError(f"must be a multiple of {house_price_fall.FALL_STEP_PCT}")
        return value


def _fall_loan(doc: dict) -> house_price_fall.Loan:
    """An application as the house price fall reads it. A figure of the wrong type is passed on as it is: the maths refuses it and lists the loan."""
    prop = doc.get("property")
    return house_price_fall.Loan(
        application_id=doc["id"],
        loan_type=doc.get("loanType"),
        loan_eur=doc.get("loanAmountEur"),
        existing_mortgage_balance_eur=doc.get("existingMortgageBalanceEur"),
        asking_price_eur=prop.get("askingPriceEur") if isinstance(prop, dict) else None,
        estimate_eur=doc.get("estimatedValueEur"),
    )


@router.post("/portfolio/downturn")
def house_price_fall_run(request: HousePriceFallRequest = Body(), user: dict = Depends(require_underwriter)) -> dict:
    return house_price_fall.run([_fall_loan(d) for d in load_active_applications()], request.fall_pct)
