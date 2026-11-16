"""POST /core/support-requests stores a borrower's support request (AL-73).

A request is stored at support_requests/{reference} (SCHEMA.md). The reference is both the document id and the
number shown to the borrower, so Firestore itself keeps it unique: create() refuses an id that exists, and the
API tries a new reference. Only this API writes to the collection. The borrower reads their own requests, and
underwriters read all of them, directly from Firestore (firestore.rules).

A request can name one of the borrower's own applications (application_id), so whoever answers can open it.
Someone else's application, or an unknown id, is a 404, the same as everywhere else in the API.
"""

import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from google.api_core.exceptions import AlreadyExists, InvalidArgument
from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import BaseModel, ConfigDict, Field

from app.applications import _iso
from app.auth import require_role
from app.firestore import db

router = APIRouter(prefix="/core", tags=["support-requests"])

# No 0, O, 1, I or L, so a reference can be read out over the phone.
REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
REFERENCE_LENGTH = 8
REFERENCE_PREFIX = "SR-"
MAX_TRIES = 5


class SupportRequestIn(BaseModel):
    """What the client sends. Anything else, such as a reference, a status or a time, is ignored."""

    model_config = ConfigDict(str_strip_whitespace=True)

    category: Literal["application", "payment", "account", "other"]
    subject: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=2000)
    application_id: str | None = Field(default=None, min_length=1, max_length=200)  # one of the borrower's own


class SupportRequestOut(BaseModel):
    reference: str
    category: str
    subject: str
    message: str
    application_id: str | None
    status: str
    created_at: str | None


def new_reference() -> str:
    return REFERENCE_PREFIX + "".join(secrets.choice(REFERENCE_ALPHABET) for _ in range(REFERENCE_LENGTH))


def _out(reference: str, doc: dict) -> dict:
    return {
        "reference": reference,
        "category": doc["category"],
        "subject": doc["subject"],
        "message": doc["message"],
        "application_id": doc.get("applicationId"),
        "status": doc["status"],
        "created_at": _iso(doc.get("createdAt")),
    }


def _check_own_application(application_id: str, uid: str) -> None:
    """404 unless the application exists and is this borrower's. Someone else's looks the same as no application."""
    try:
        snap = db().collection("applications").document(application_id).get()
        found = snap.exists and snap.to_dict().get("borrowerId") == uid
    except (ValueError, InvalidArgument):
        found = False  # not a usable Firestore document id, so there can be no such application
    if not found:
        raise HTTPException(404, "No application with that id")


@router.post("/support-requests", status_code=201, response_model=SupportRequestOut)
def send_support_request(body: SupportRequestIn, user: dict = Depends(require_role("borrower"))):
    """Store a support request for the signed-in borrower and return it with its reference number."""
    if body.application_id is not None:
        _check_own_application(body.application_id, user["uid"])
    data = {
        "userId": user["uid"],
        "category": body.category,
        "subject": body.subject,
        "message": body.message,
        "applicationId": body.application_id,
        "status": "open",
        "createdAt": SERVER_TIMESTAMP,
    }
    for _ in range(MAX_TRIES):
        ref = db().collection("support_requests").document(new_reference())
        try:
            ref.create(data)
        except AlreadyExists:
            continue  # a clash is a one-in-a-trillion event, but a retry costs nothing
        return _out(ref.id, ref.get().to_dict())
    raise HTTPException(503, "Could not create a reference number. Try again")
