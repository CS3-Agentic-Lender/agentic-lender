"""POST /core/saved-checks keeps a property check a borrower ran, and DELETE /core/saved-checks/{id} removes it.

A saved check is stored at users/{uid}/saved_checks/{checkId} (SCHEMA.md). The app reads that collection
directly, so there is no list endpoint, and only this API writes to it. The client sends the valuation result
it already has, and the API validates and stores it: it does not call al-ai again. A borrower keeps at most
MAX_SAVED_CHECKS. API fields are snake_case, Firestore camelCase.

The property uses the application's names and rules (applications.PropertyIn), so a saved check can always
fill an application's property. It has no address lines: a saved check is about the kind of home.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from google.api_core.exceptions import InvalidArgument
from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.applications import _invalid, _iso
from app.auth import require_role
from app.firestore import db
from app.me import EIRCODE

router = APIRouter(prefix="/core", tags=["saved-checks"])

MAX_SAVED_CHECKS = 20
WARNING = Annotated[str, Field(min_length=1, max_length=300)]


class SavedCheckProperty(BaseModel):
    """The home that was checked. Same names and limits as the application's property, with the valuation's
    inputs required: a check without them could not have been run, and could not fill an application."""

    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)

    county: str = Field(min_length=1, max_length=50)
    eircode: str  # the full Eircode: the valuation needs it, and so does filling an application
    property_type: str = Field(min_length=1, max_length=50)
    bedrooms: int = Field(ge=0, le=20)
    floor_area_sqm: float = Field(gt=0, le=10_000)
    ber_rating: str = Field(min_length=1, max_length=10)
    asking_price_eur: float | None = Field(default=None, gt=0, le=100_000_000)

    @field_validator("eircode")
    @classmethod
    def eircode_format(cls, v: str) -> str:
        # Same rule as the profile and the application.
        if not EIRCODE.match(v):
            raise ValueError('must be capitals with a space, for example "A65 F4E2"')
        return v


class SavedCheckIn(BaseModel):
    """What the client sends: the check and the result it got. Anything else, such as an id or a time, is ignored."""

    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False)

    property: SavedCheckProperty
    estimated_value_eur: float = Field(gt=0, le=100_000_000)
    asking_price_gap: float | None = Field(default=None, ge=-1, le=1_000_000)  # asking price / estimate - 1
    price_needs_review: bool | None = None
    support_warnings: list[WARNING] = Field(default_factory=list, max_length=20)
    model_version: str = Field(min_length=1, max_length=50)


class SavedCheckOut(BaseModel):
    id: str
    property: SavedCheckProperty
    estimated_value_eur: float
    asking_price_gap: float | None
    price_needs_review: bool | None
    support_warnings: list[str]
    model_version: str
    created_at: str | None


PROPERTY = {
    "county": "county",
    "eircode": "eircode",
    "property_type": "propertyType",
    "bedrooms": "bedrooms",
    "floor_area_sqm": "floorAreaSqm",
    "ber_rating": "berRating",
    "asking_price_eur": "askingPriceEur",
}


def _checks(uid: str):
    return db().collection("users").document(uid).collection("saved_checks")


def _out(check_id: str, doc: dict) -> dict:
    """Firestore camelCase to API snake_case."""
    prop = doc.get("property") or {}
    return {
        "id": check_id,
        "property": {api: prop.get(fs) for api, fs in PROPERTY.items()},
        "estimated_value_eur": doc.get("estimatedValueEur"),
        "asking_price_gap": doc.get("askingPriceGap"),
        "price_needs_review": doc.get("priceNeedsReview"),
        "support_warnings": list(doc.get("supportWarnings") or []),
        "model_version": doc.get("modelVersion"),
        "created_at": _iso(doc.get("createdAt")),
    }


@router.post("/saved-checks", status_code=201, response_model=SavedCheckOut)
def save_check(body: SavedCheckIn, user: dict = Depends(require_role("borrower"))):
    """Save a property check for the signed-in borrower. At most 20: the 21st is refused with 409."""
    if body.property.asking_price_eur is None:
        # With no asking price there is nothing to compare, so there is no gap and no review flag.
        for field in ("asking_price_gap", "price_needs_review"):
            if getattr(body, field) is not None:
                raise _invalid(field, "can only be sent with an asking price")

    checks = _checks(user["uid"])
    if len(list(checks.limit(MAX_SAVED_CHECKS).stream())) >= MAX_SAVED_CHECKS:
        raise HTTPException(409, f"You can keep at most {MAX_SAVED_CHECKS} saved property checks. Delete one to save another")

    prop = body.property
    data = {
        "property": {fs: getattr(prop, api) for api, fs in PROPERTY.items() if getattr(prop, api) is not None},
        "estimatedValueEur": body.estimated_value_eur,
        "askingPriceGap": body.asking_price_gap,
        "priceNeedsReview": body.price_needs_review,
        "supportWarnings": body.support_warnings,
        "modelVersion": body.model_version,
        "createdAt": SERVER_TIMESTAMP,
    }
    ref = checks.document()
    ref.set(data)
    return _out(ref.id, ref.get().to_dict())


@router.delete("/saved-checks/{check_id}", status_code=204, response_class=Response)
def delete_check(check_id: str, user: dict = Depends(require_role("borrower"))):
    """Remove one of the signed-in borrower's saved checks. Someone else's, or an unknown id, is 404."""
    try:
        ref = _checks(user["uid"]).document(check_id)
        found = ref.get().exists
    except (ValueError, InvalidArgument):
        found = False  # not a usable Firestore document id, so there can be no such check
    if not found:
        raise HTTPException(404, "No saved check with that id")
    ref.delete()
    return Response(status_code=204)
