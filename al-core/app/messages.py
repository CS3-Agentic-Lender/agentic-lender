"""POST /core/applications/{id}/messages sends a message on an application's thread, and
POST /core/applications/{id}/messages/read marks the caller's unread messages as read.

A thread belongs to an application: the borrower, the broker the application is assigned to and the bank's
underwriters talk in it. The apps read the messages straight from Firestore (the rules allow exactly those three) and every
write comes through here, so the sender's id and role come from the token, never from the body, and a message can't be
edited or deleted: there is no endpoint for either. Nothing is open before the application is submitted: a broker can't see a
Draft, so a thread on one would have only one side.
"""

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import SERVER_TIMESTAMP
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel, field_validator

from app.applications import _iso
from app.auth import require_role
from app.firestore import db

router = APIRouter(prefix="/core", tags=["messages"])

MAX_TEXT = 2000


class MessageIn(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def not_blank_or_long(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("can't be empty")
        if len(value) > MAX_TEXT:
            raise ValueError(f"can be at most {MAX_TEXT} characters")
        return value


class MessageOut(BaseModel):
    id: str
    application_id: str
    sender_id: str
    sender_role: str
    text: str
    sent_at: str | None = None
    read: bool


class ReadOut(BaseModel):
    marked: int  # how many messages this call marked as read


def _thread(application_id: str, user: dict):
    """The application's reference, if the caller is in its thread and it has been submitted. Anyone else gets the same
    404 as an unknown id, so nobody can probe which ids exist."""
    ref = db().collection("applications").document(application_id)
    snap = ref.get()
    doc = snap.to_dict() if snap.exists else None
    role, uid = user.get("role"), user["uid"]
    in_thread = doc is not None and (
        role == "underwriter"
        or (role == "broker" and doc.get("brokerId") == uid)
        or (role == "borrower" and doc.get("borrowerId") == uid)
    )
    if not in_thread:
        raise HTTPException(404, "No application with that id")
    if doc.get("status") == "Draft":
        raise HTTPException(409, "Messages open once the application is submitted")
    return ref


def _out(application_id: str, message_id: str, doc: dict) -> dict:
    return {
        "id": message_id,
        "application_id": application_id,
        "sender_id": doc["senderId"],
        "sender_role": doc["senderRole"],
        "text": doc["text"],
        "sent_at": _iso(doc.get("sentAt")),
        "read": bool(doc.get("read", False)),
    }


@router.post("/applications/{application_id}/messages", status_code=201, response_model=MessageOut)
def send_message(application_id: str, body: MessageIn, user: dict = Depends(require_role("borrower", "broker", "underwriter"))):
    """Send a message on the application's thread. The borrower, the assigned broker and any underwriter can; anyone else
    gets 404. The sender is the caller, from the token. It starts unread."""
    ref = _thread(application_id, user)
    message = ref.collection("messages").document()
    message.set({"senderId": user["uid"], "senderRole": user["role"], "text": body.text, "sentAt": SERVER_TIMESTAMP, "read": False})
    return _out(application_id, message.id, message.get().to_dict())


# A thread has two sides: the borrower, and the bank's staff (the broker and the underwriters). `read` is one flag on a message
# and means "the other side has read it", so a message from staff is cleared only by the borrower and a message from the
# borrower only by staff. Staff messages to each other are never cleared here: per-person unread state is a later ticket.
STAFF = ("broker", "underwriter")
BATCH = 450  # Firestore allows 500 writes in one batch


def _senders_for(role: str) -> tuple[str, ...]:
    return ("borrower",) if role in STAFF else STAFF


@router.post("/applications/{application_id}/messages/read", response_model=ReadOut)
def mark_read(application_id: str, user: dict = Depends(require_role("borrower", "broker", "underwriter"))):
    """Mark the unread messages sent to the caller's side as read: the borrower clears what the bank's staff sent, and a broker
    or an underwriter clears what the borrower sent. A broker opening the thread never clears the underwriter's message to the
    borrower, so the borrower's unread count stays right. The messages are updated together (all or none, up to 450 at a
    time). Safe to repeat."""
    ref = _thread(application_id, user)
    wanted = _senders_for(user["role"])
    unread = [
        snap for snap in ref.collection("messages").where(filter=FieldFilter("read", "==", False)).stream()
        if snap.to_dict().get("senderRole") in wanted
    ]
    for start in range(0, len(unread), BATCH):
        batch = db().batch()
        for snap in unread[start:start + BATCH]:
            batch.update(snap.reference, {"read": True})
        batch.commit()
    return {"marked": len(unread)}
