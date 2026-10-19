"""POST /core/applications saves a borrower's Draft, PATCH /core/applications/{id} edits it,
POST /core/applications/{id}/submit sends it to the broker and the bank, and
GET /core/applications/{id} reads one back.

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
from google.api_core.exceptions import FailedPrecondition
from google.cloud.firestore import DELETE_FIELD, SERVER_TIMESTAMP
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth import current_user, require_role
from app.firestore import db
from app.me import EIRCODE

router = APIRouter(prefix="/core", tags=["applications"])


def money():
    """An optional euro amount: never negative, never NaN or infinity."""
    return Field(default=None, ge=0, le=100_000_000)


class PropertyIn(BaseModel):
    """The home being bought (mortgage) or borrowed against (HELOC). Every field is optional on a Draft."""

    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)

    address_line_1: str | None = Field(default=None, min_length=1, max_length=200)
    address_line_2: str | None = Field(default=None, max_length=200)
    eircode: str | None = None
    county: str | None = Field(default=None, min_length=1, max_length=50)
    property_type: str | None = Field(default=None, min_length=1, max_length=50)
    bedrooms: int | None = Field(default=None, ge=0, le=20)
    floor_area_sqm: float | None = Field(default=None, gt=0, le=10_000)
    ber_rating: str | None = Field(default=None, min_length=1, max_length=10)
    asking_price_eur: float | None = Field(default=None, gt=0, le=100_000_000)

    @field_validator("address_line_2")
    @classmethod
    def empty_is_absent(cls, v: str | None) -> str | None:
        return v or None

    @field_validator("eircode")
    @classmethod
    def eircode_format(cls, v: str | None) -> str | None:
        # Same rule as the profile (POST /core/me).
        if v is not None and not EIRCODE.match(v):
            raise ValueError('must be capitals with a space, for example "A65 F4E2"')
        return v


class ApplicationFields(BaseModel):
    """The borrower's inputs, shared by creating and editing a Draft. All optional until submit."""

    # Unknown fields, such as a `status` or `broker_id` someone adds, are ignored.
    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)

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


class DraftIn(ApplicationFields):
    """A new Draft. Only `loan_type` is required; the rest is checked at submit."""

    loan_type: Literal["mortgage", "heloc"]


class DraftPatch(ApplicationFields):
    """Changes to a Draft. Only the fields sent change, `null` clears one, and `property` is
    merged field by field. `loan_type` can be changed but not cleared."""

    loan_type: Literal["mortgage", "heloc"] | None = None


class PropertyOut(BaseModel):
    address_line_1: str | None = None
    address_line_2: str | None = None
    eircode: str | None = None
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
    "address_line_1": "addressLine1",
    "address_line_2": "addressLine2",
    "eircode": "eircode",
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

# Needed to submit, checked in this order so the first missing one is named (AL-245).
REQUIRED_TO_SUBMIT = (
    "applicants",
    "gross_income_eur",
    "monthly_debts_eur",
    "monthly_take_home_eur",
    "monthly_living_costs_eur",
    "employment_type",
    "years_in_current_job",
    "loan_amount_eur",
    "term_years",
)
PROPERTY_REQUIRED_TO_SUBMIT = ("address_line_1", "county", "eircode", "asking_price_eur")


def _invalid(field: str, message: str) -> RequestValidationError:
    return RequestValidationError([{"loc": ("body", field), "msg": message, "type": "value_error"}])


def _check_loan_type_fields(loan_type: str, sent: dict) -> None:
    """A mortgage-only field on a HELOC, or the other way round, is a 422 naming that field."""
    wrong = MORTGAGE_ONLY if loan_type == "heloc" else HELOC_ONLY
    for field in wrong:
        if sent.get(field) is not None:
            other = "mortgage" if loan_type == "heloc" else "HELOC"
            raise _invalid(field, f"only applies to a {other}")


def _own_application(application_id: str, uid: str):
    """The signed-in borrower's application, or 404 (the same for someone else's, so ids can't be probed).

    Also returns when it was last written, so the change can be made only if nothing else wrote
    in between (see _update_if_unchanged).
    """
    ref = db().collection("applications").document(application_id)
    snap = ref.get()
    if not snap.exists or snap.to_dict().get("borrowerId") != uid:
        raise HTTPException(404, "No application with that id")
    return ref, snap.to_dict(), snap.update_time


def _update_if_unchanged(ref, changes: dict, read_at) -> None:
    """Write only if the application hasn't changed since it was read, so an edit can't land after a
    submit (or a submit go through on fields an edit has just cleared). Firestore checks this itself."""
    try:
        ref.update(changes, option=db().write_option(last_update_time=read_at))
    except FailedPrecondition:
        raise HTTPException(409, "The application changed while this request was running; read it again and retry")


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
    _check_loan_type_fields(body.loan_type, sent)

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


@router.patch("/applications/{application_id}", response_model=ApplicationOut)
def edit_draft(application_id: str, body: DraftPatch, user: dict = Depends(require_role("borrower"))):
    """Change the signed-in borrower's Draft. Only the fields sent change; `null` clears a field.

    `property` is merged field by field, and `"property": null` clears the whole property.
    Changing `loan_type` drops the other loan type's fields (a deposit when moving to a HELOC,
    the existing mortgage balance when moving to a mortgage). Once submitted, it can't be edited (409).
    """
    ref, doc, read_at = _own_application(application_id, user["uid"])
    if doc.get("status") != "Draft":
        raise HTTPException(409, f"Only a Draft can be edited; this application is {doc.get('status')}")

    sent = body.model_dump(exclude_unset=True)
    if "loan_type" in sent and sent["loan_type"] is None:
        raise _invalid("loan_type", "can't be cleared, only changed")
    old_type = doc.get("loanType", "mortgage")
    loan_type = sent.get("loan_type") or old_type
    _check_loan_type_fields(loan_type, sent)

    changes = {}
    if loan_type != old_type:
        changes["loanType"] = loan_type
        for api in MORTGAGE_ONLY if loan_type == "heloc" else HELOC_ONLY:
            changes[INPUTS[api]] = DELETE_FIELD
    for api, fs in INPUTS.items():
        if api in sent:
            changes[fs] = DELETE_FIELD if sent[api] is None else sent[api]
    if "property" in sent:
        if sent["property"] is None:
            changes["property"] = DELETE_FIELD
        else:
            for api, value in sent["property"].items():
                changes[f"property.{PROPERTY[api]}"] = DELETE_FIELD if value is None else value
    changes["updatedAt"] = SERVER_TIMESTAMP

    _update_if_unchanged(ref, changes, read_at)
    return _out(ref.id, ref.get().to_dict())


def _first_missing(doc: dict) -> str | None:
    """The first field a submit needs that the Draft hasn't filled in, as an API path, or None."""
    loan_type = doc.get("loanType", "mortgage")
    needed = REQUIRED_TO_SUBMIT + (MORTGAGE_ONLY if loan_type == "mortgage" else HELOC_ONLY)
    for api in needed:
        if doc.get(INPUTS[api]) is None:  # 0 and false are real answers, only missing counts
            return api
    prop = doc.get("property") or {}
    for api in PROPERTY_REQUIRED_TO_SUBMIT:
        if prop.get(PROPERTY[api]) is None:
            return f"property.{api}"
    return None


@router.post("/applications/{application_id}/submit", response_model=ApplicationOut)
def submit(application_id: str, user: dict = Depends(require_role("borrower"))):
    """Submit the signed-in borrower's Draft: its status moves to Applied, which starts the AI review.

    Every field the assessment needs must be filled in first, or it is 422 naming the first one
    missing. Safe to repeat: an application that is already Applied comes back unchanged. Any later
    status is 409. Once submitted the borrower can no longer edit it.
    """
    ref, doc, read_at = _own_application(application_id, user["uid"])
    status = doc.get("status")
    if status == "Applied":
        return _out(ref.id, doc)
    if status != "Draft":
        raise HTTPException(409, f"Only a Draft can be submitted; this application is {status}")

    missing = _first_missing(doc)
    if missing:
        raise RequestValidationError(
            [{"loc": ("body", *missing.split(".")), "msg": "is required to submit", "type": "missing"}]
        )

    _update_if_unchanged(ref, {"status": "Applied", "submittedAt": SERVER_TIMESTAMP, "updatedAt": SERVER_TIMESTAMP}, read_at)
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
