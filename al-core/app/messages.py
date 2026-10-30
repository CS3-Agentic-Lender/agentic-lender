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


@router.post("/applications/{application_id}/messages/read", response_model=ReadOut)
def mark_read(application_id: str, user: dict = Depends(require_role("borrower", "broker", "underwriter"))):
    """Mark the caller's unread messages as read: every unread message on the thread that someone else sent. Messages the
    caller sent are never marked by the caller, since they are for the other side. Safe to repeat.

    `read` is one flag on the message, so a message for the bank's staff is cleared for the broker and the underwriter
    together; per-person unread counts are a later ticket."""
    ref = _thread(application_id, user)
    marked = 0
    for snap in ref.collection("messages").where(filter=FieldFilter("read", "==", False)).stream():
        if snap.to_dict().get("senderId") == user["uid"]:
            continue
        snap.reference.update({"read": True})
        marked += 1
    return {"marked": marked}
