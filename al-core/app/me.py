"""POST /core/me creates the caller's borrower profile and role claim; GET /core/me returns it.

API fields are snake_case, Firestore fields camelCase (docs/api-design.md). The role is never read
from the request body: sign-up here always makes a borrower, and it comes from the token after.
"""

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from firebase_admin import auth as fb_auth
from google.api_core.exceptions import AlreadyExists
from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth import current_user
from app.firestore import db

router = APIRouter(prefix="/core")

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE = re.compile(r"^\+353\d{7,9}$")
EIRCODE = re.compile(r"^[A-Z][0-9][0-9W] [A-Z0-9]{4}$")


class SignUp(BaseModel):
    # Unknown fields, such as a `role` someone adds, are ignored.
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str = Field(min_length=1, max_length=100)
    email: str = Field(max_length=254)
    phone: str
    address_line_1: str = Field(min_length=1, max_length=200)
    address_line_2: str | None = Field(default=None, max_length=200)
    county: str = Field(min_length=1, max_length=50)
    eircode: str

    @field_validator("email")
    @classmethod
    def lower_case_email(cls, v: str) -> str:
        if not EMAIL.match(v):
            raise ValueError("must be a valid email address")
        return v.lower()

    @field_validator("phone")
    @classmethod
    def irish_phone(cls, v: str) -> str:
        v = v.replace(" ", "")
        if not PHONE.match(v):
            raise ValueError("must start +353 followed by 7 to 9 digits")
        return v

    @field_validator("address_line_2")
    @classmethod
    def empty_is_absent(cls, v: str | None) -> str | None:
        return v or None

    @field_validator("eircode")
    @classmethod
    def eircode_format(cls, v: str) -> str:
        if not EIRCODE.match(v):
            raise ValueError('must be capitals with a space, for example "A65 F4E2"')
        return v


def _iso(ts) -> str | None:
    if ts is None:
        return None
    return ts.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _profile(doc: dict) -> dict:
    """Firestore camelCase to API snake_case."""
    return {
        "uid": doc["uid"],
        "role": doc.get("role"),
        "full_name": doc.get("fullName"),
        "email": doc.get("email"),
        "phone": doc.get("phone"),
        "address_line_1": doc.get("addressLine1"),
        "address_line_2": doc.get("addressLine2"),
        "county": doc.get("county"),
        "eircode": doc.get("eircode"),
        "broker_id": doc.get("brokerId"),
        "created_at": _iso(doc.get("createdAt")),
    }


@router.post("/me", status_code=201)
def sign_up(body: SignUp, response: Response, user: dict = Depends(current_user)):
    uid = user["uid"]
    role = user.get("role")
    if role and role != "borrower":
        raise HTTPException(403, "Only borrowers can sign up here")

    # One email per person: the profile keeps the one they signed in with.
    token_email = (user.get("email") or "").lower()
    if token_email and body.email != token_email:
        raise RequestValidationError(
            [{"loc": ("body", "email"), "msg": "must match the email you signed in with", "type": "value_error"}]
        )

    ref = db().collection("users").document(uid)
    data = {
        "uid": uid,
        "role": "borrower",
        "fullName": body.full_name,
        "email": body.email,
        "phone": body.phone,
        "addressLine1": body.address_line_1,
        "county": body.county,
        "eircode": body.eircode,
        "createdAt": SERVER_TIMESTAMP,
    }
    if body.address_line_2:
        data["addressLine2"] = body.address_line_2

    try:
        ref.create(data)  # fails if the profile exists, so two calls can never make two profiles
    except AlreadyExists:
        response.status_code = 200  # repeat call: return the existing profile unchanged

    if role != "borrower":
        # Also covers a first call that wrote the profile but failed before setting the claim.
        fb_auth.set_custom_user_claims(uid, {"role": "borrower"})

    return _profile(ref.get().to_dict())


@router.get("/me")
def get_me(user: dict = Depends(current_user)):
    snap = db().collection("users").document(user["uid"]).get()
    if not snap.exists:
        raise HTTPException(404, "No profile yet. Call POST /core/me to create one")
    return _profile(snap.to_dict())
