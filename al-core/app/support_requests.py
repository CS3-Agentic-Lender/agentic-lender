"""POST /core/support-requests stores a borrower's support request (AL-73). Admins comment on it, close it with an
optional resolution note, and reopen it (AL-339).

A request is stored at support_requests/{reference} (SCHEMA.md). The reference is both the document id and the
number shown to the borrower, so Firestore itself keeps it unique: create() refuses an id that exists, and the
API tries a new reference. Only this API writes to the collection. The borrower reads their own requests, and
admins read all of them, directly from Firestore (firestore.rules).

Notes are staff-only comments at support_requests/{reference}/notes/{id}, one document each, so two admins commenting
at once never overwrite each other. Only admins read them (firestore.rules); the sender never sees them. A resolved
(closed) request takes no notes until it is reopened.

A request can name one of the borrower's own applications (application_id), so whoever answers can open it.
Someone else's application, or an unknown id, is a 404, the same as everywhere else in the API.
"""

import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from google.api_core.exceptions import AlreadyExists, FailedPrecondition, InvalidArgument
from google.cloud.firestore import DELETE_FIELD, SERVER_TIMESTAMP, transactional
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
    closed_at: str | None
    closed_by: str | None  # the uid of the admin who closed it
    resolution: str | None  # the note the admin closed it with, if any


class CloseIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    resolution: str | None = Field(default=None, max_length=2000)  # blank is the same as none


class NoteIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=2000)


class NoteOut(BaseModel):
    id: str
    author_uid: str
    text: str
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
        "closed_at": _iso(doc.get("closedAt")),
        "closed_by": doc.get("closedBy"),
        "resolution": doc.get("resolution"),
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


def _existing(reference: str):
    """The request's reference and snapshot, or a 404."""
    ref = db().collection("support_requests").document(reference)
    try:
        snap = ref.get()
    except (ValueError, InvalidArgument):
        snap = None  # not a usable Firestore document id, so there can be no such request
    if snap is None or not snap.exists:
        raise HTTPException(404, "No support request with that reference")
    return ref, snap


def _log(batch, user: dict, action: str, reference: str, doc: dict, **details):
    batch.set(db().collection("admin_actions").document(), {
        "actorUid": user["uid"],
        "action": action,
        "targetRef": f"support_requests/{reference}",
        "details": {"subject": doc["subject"], "userId": doc["userId"], **details},
        "createdAt": SERVER_TIMESTAMP,
    })


def _change_status(reference: str, user: dict, to: str, changes: dict, action: str, **details) -> dict:
    """Move a request to `to` and log it, in one batch guarded on the request being unchanged since it was read.

    A request already at `to` answers 200 unchanged and logs nothing, so two admins doing the same thing at once leave
    one change and one record: the loser finds it already there.
    """
    ref, snap = _existing(reference)
    doc = snap.to_dict()
    if doc["status"] == to:
        return _out(reference, doc)

    batch = db().batch()
    batch.update(ref, {"status": to, **changes}, option=db().write_option(last_update_time=snap.update_time))
    _log(batch, user, action, reference, doc, **details)
    try:
        batch.commit()
    except FailedPrecondition:
        if ref.get().to_dict()["status"] != to:
            raise HTTPException(409, "The support request changed while this request was running; read it again and retry")
    return _out(reference, ref.get().to_dict())


@router.post("/admin/support-requests/{reference}/close", response_model=SupportRequestOut)
def close_support_request(reference: str, body: CloseIn | None = None, user: dict = Depends(require_role("admin"))):
    """Close a support request, with an optional resolution note. 200 with the request, whether closed now or before."""
    resolution = {"resolution": body.resolution} if body and body.resolution else {}
    changes = {"closedAt": SERVER_TIMESTAMP, "closedBy": user["uid"], **resolution}
    return _change_status(reference, user, "closed", changes, "close_support_request", **resolution)


@router.post("/admin/support-requests/{reference}/reopen", response_model=SupportRequestOut)
def reopen_support_request(reference: str, user: dict = Depends(require_role("admin"))):
    """Reopen a closed request: clears closedAt, closedBy and resolution, and keeps the notes."""
    changes = {"closedAt": DELETE_FIELD, "closedBy": DELETE_FIELD, "resolution": DELETE_FIELD}
    return _change_status(reference, user, "open", changes, "reopen_support_request")


@router.post("/admin/support-requests/{reference}/notes", response_model=NoteOut, status_code=201)
def add_support_note(reference: str, body: NoteIn, user: dict = Depends(require_role("admin"))):
    """Add a staff note to an open request and log it. A resolved request is a 409 until it is reopened."""
    ref, _ = _existing(reference)
    note = _add_note(db().transaction(), ref, reference, user, body.text)
    saved = note.get().to_dict()
    return {"id": note.id, "author_uid": saved["authorUid"], "text": saved["text"], "created_at": _iso(saved["createdAt"])}


@transactional
def _add_note(transaction, ref, reference: str, user: dict, text: str):
    """Read the status and write the note in one transaction, so a close that lands first turns this into the 409."""
    doc = ref.get(transaction=transaction).to_dict()
    if doc["status"] == "closed":
        raise HTTPException(409, "This request is resolved. Reopen it to add a note.")
    note = ref.collection("notes").document()
    transaction.set(note, {"authorUid": user["uid"], "text": text, "createdAt": SERVER_TIMESTAMP})
    _log(transaction, user, "comment_support_request", reference, doc, noteId=note.id)
    return note
