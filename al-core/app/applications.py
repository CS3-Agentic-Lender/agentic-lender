"""POST /core/applications saves a borrower's Draft; GET /core/applications/{id} reads one back.

A Draft only needs `loan_type`: everything else on the application form is optional until the
application is submitted (SCHEMA.md, applications). A borrower has one active application at a
time (AL-20): asking for a new one while a Draft exists returns that Draft, and while a submitted
one is in progress it is refused with 409. The status, borrower, broker and timestamps
are set here, never taken from the request body. API fields are snake_case, Firestore camelCase.
"""

from datetime import timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from google.cloud.firestore import SERVER_TIMESTAMP
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel, ConfigDict, Field

from app.auth import current_user, require_role
from app.firestore import db

router = APIRouter(prefix="/core", tags=["applications"])


def money():
    """An optional euro amount: never negative, never NaN or infinity."""
    return Field(default=None, ge=0, le=100_000_000)


class PropertyIn(BaseModel):
    """The home being bought (mortgage) or borrowed against (HELOC). Every field is optional on a Draft."""

    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)

    county: str | None = Field(default=None, min_length=1, max_length=50)
    property_type: str | None = Field(default=None, min_length=1, max_length=50)
    bedrooms: int | None = Field(default=None, ge=0, le=20)
    floor_area_sqm: float | None = Field(default=None, gt=0, le=10_000)
    ber_rating: str | None = Field(default=None, min_length=1, max_length=10)
    asking_price_eur: float | None = Field(default=None, gt=0, le=100_000_000)


class DraftIn(BaseModel):
    """A Draft application. Only `loan_type` is required; the rest is checked again at submit."""

    # Unknown fields, such as a `status` or `broker_id` someone adds, are ignored.
    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)

    loan_type: Literal["mortgage", "heloc"]
    gross_income_eur: float | None = money()
    monthly_debts_eur: float | None = money()
    monthly_take_home_eur: float | None = money()
    monthly_living_costs_eur: float | None = money()
    employment_type: Literal["employed", "self_employed", "other"] | None = None
    years_in_current_job: float | None = Field(default=None, ge=0, le=60)
    applicants: Literal["single", "joint"] | None = None
    existing_mortgage_balance_eur: float | None = money()
    deposit_eur: float | None = money()
    first_time_buyer: bool | None = None
    loan_amount_eur: float | None = Field(default=None, gt=0, le=100_000_000)
    term_years: int | None = Field(default=None, ge=1, le=40)
    property: PropertyIn | None = None


class PropertyOut(BaseModel):
    county: str | None = None
    property_type: str | None = None
    bedrooms: int | None = None
    floor_area_sqm: float | None = None
    ber_rating: str | None = None
    asking_price_eur: float | None = None


class ApplicationOut(BaseModel):
    id: str
    borrower_id: str
    broker_id: str
    borrower_name: str | None = None
    status: str
    loan_type: str
    gross_income_eur: float | None = None
    monthly_debts_eur: float | None = None
    monthly_take_home_eur: float | None = None
    monthly_living_costs_eur: float | None = None
    employment_type: str | None = None
    years_in_current_job: float | None = None
    applicants: str | None = None
    existing_mortgage_balance_eur: float | None = None
    deposit_eur: float | None = None
    first_time_buyer: bool | None = None
    loan_amount_eur: float | None = None
    term_years: int | None = None
    property: PropertyOut | None = None
    estimated_value_eur: float | None = None
    ltv_pct: float | None = None
    created_at: str | None = None
    submitted_at: str | None = None
    updated_at: str | None = None


# API name -> Firestore name for the borrower inputs.
INPUTS = {
    "gross_income_eur": "grossIncomeEur",
    "monthly_debts_eur": "monthlyDebtsEur",
    "monthly_take_home_eur": "monthlyTakeHomeEur",
    "monthly_living_costs_eur": "monthlyLivingCostsEur",
    "employment_type": "employmentType",
    "years_in_current_job": "yearsInCurrentJob",
    "applicants": "applicants",
    "existing_mortgage_balance_eur": "existingMortgageBalanceEur",
    "deposit_eur": "depositEur",
    "first_time_buyer": "firstTimeBuyer",
    "loan_amount_eur": "loanAmountEur",
    "term_years": "termYears",
}
PROPERTY = {
    "county": "county",
    "property_type": "propertyType",
    "bedrooms": "bedrooms",
    "floor_area_sqm": "floorAreaSqm",
    "ber_rating": "berRating",
    "asking_price_eur": "askingPriceEur",
}
# Statuses after which the borrower may start a new application.
FINISHED = {"Declined", "Closed"}
MORTGAGE_ONLY = ("deposit_eur", "first_time_buyer")
HELOC_ONLY = ("existing_mortgage_balance_eur",)


def _invalid(field: str, message: str) -> RequestValidationError:
    return RequestValidationError([{"loc": ("body", field), "msg": message, "type": "value_error"}])


def _iso(ts) -> str | None:
    if ts is None or isinstance(ts, str):
        return ts  # seed data stores some timestamps as ISO strings already
    return ts.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _out(app_id: str, doc: dict) -> dict:
    """Firestore camelCase to API snake_case."""
    prop = doc.get("property")
    return {
        "id": app_id,
        "borrower_id": doc["borrowerId"],
        "broker_id": doc["brokerId"],
        "borrower_name": doc.get("borrowerName"),
        "status": doc["status"],
        "loan_type": doc.get("loanType", "mortgage"),
        **{api: doc.get(fs) for api, fs in INPUTS.items()},
        "property": {api: prop.get(fs) for api, fs in PROPERTY.items()} if prop else None,
        "estimated_value_eur": doc.get("estimatedValueEur"),
        "ltv_pct": doc.get("ltvPct"),
        "created_at": _iso(doc.get("createdAt")),
        "submitted_at": _iso(doc.get("submittedAt")),
        "updated_at": _iso(doc.get("updatedAt")),
    }


@router.post(
    "/applications",
    status_code=201,
    response_model=ApplicationOut,
    responses={200: {"model": ApplicationOut, "description": "The borrower's existing Draft, unchanged"}},
)
def create_draft(body: DraftIn, response: Response, user: dict = Depends(require_role("borrower"))):
    """Save a new Draft for the signed-in borrower, assigned to their current broker.

    One active application per borrower: if they already have a Draft it is returned unchanged
    (200), and if a submitted application is still in progress the call is refused (409).
    """
    sent = body.model_dump(exclude_none=True)
    wrong = MORTGAGE_ONLY if body.loan_type == "heloc" else HELOC_ONLY
    for field in wrong:
        if field in sent:
            other = "mortgage" if body.loan_type == "heloc" else "HELOC"
            raise _invalid(field, f"only applies to a {other}")

    uid = user["uid"]
    profile = db().collection("users").document(uid).get()
    if not profile.exists:
        raise HTTPException(409, "Create your profile first with POST /core/me")
    profile = profile.to_dict()
    if not profile.get("brokerId"):
        raise HTTPException(409, "Choose a broker before starting an application")

    mine = db().collection("applications").where(filter=FieldFilter("borrowerId", "==", uid)).stream()
    for snap in mine:
        existing = snap.to_dict()
        if existing.get("status") == "Draft":
            response.status_code = 200
            return _out(snap.id, existing)
        if existing.get("status") not in FINISHED:
            raise HTTPException(409, f"You already have an application in progress ({snap.id})")

    data = {
        "borrowerId": uid,
        # Copied now and kept if the borrower later changes broker, so this broker keeps the
        # application and can still show the client's name without reading their profile.
        "brokerId": profile["brokerId"],
        "borrowerName": profile.get("fullName"),
        "status": "Draft",
        "loanType": body.loan_type,
        "createdAt": SERVER_TIMESTAMP,
        "updatedAt": SERVER_TIMESTAMP,
    }
    data.update({fs: sent[api] for api, fs in INPUTS.items() if api in sent})
    if "property" in sent:
        data["property"] = {fs: sent["property"][api] for api, fs in PROPERTY.items() if api in sent["property"]}

    ref = db().collection("applications").document()
    ref.set(data)
    return _out(ref.id, ref.get().to_dict())


@router.get("/applications/{application_id}", response_model=ApplicationOut)
def get_application(application_id: str, user: dict = Depends(current_user)):
    """The borrower reads their own, a broker their assigned clients', an underwriter any."""
    snap = db().collection("applications").document(application_id).get()
    if not snap.exists:
        raise HTTPException(404, "No application with that id")
    doc = snap.to_dict()
    role, uid = user.get("role"), user["uid"]
    allowed = (
        role == "underwriter"
        or (role == "broker" and doc.get("brokerId") == uid)
        or (role == "borrower" and doc.get("borrowerId") == uid)
    )
    if not allowed:
        # Same answer as a missing id, so nobody can probe which ids exist.
        raise HTTPException(404, "No application with that id")
    return _out(snap.id, doc)
