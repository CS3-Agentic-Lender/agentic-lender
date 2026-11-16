"""POST /core/support-requests stores a borrower's support request (AL-73).

A request is stored at support_requests/{reference} (SCHEMA.md). The reference is both the document id and the
number shown to the borrower, so Firestore itself keeps it unique: create() refuses an id that exists, and the
API tries a new reference. Only this API writes to the collection. The borrower reads their own requests, and
underwriters read all of them, directly from Firestore (firestore.rules).
"""

import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from google.api_core.exceptions import AlreadyExists
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


class SupportRequestOut(BaseModel):
    reference: str
    category: str
    subject: str
    message: str
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
        "status": doc["status"],
        "created_at": _iso(doc.get("createdAt")),
    }


@router.post("/support-requests", status_code=201, response_model=SupportRequestOut)
def send_support_request(body: SupportRequestIn, user: dict = Depends(require_role("borrower"))):
    """Store a support request for the signed-in borrower and return it with its reference number."""
    data = {
        "userId": user["uid"],
        "category": body.category,
        "subject": body.subject,
        "message": body.message,
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
