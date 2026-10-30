"""POST /core/applications/{id}/decision records an underwriter's sign-off.

The decision, who made it, when and why are saved on the application together with the move from
AI Deliberated to Underwriter Approved or Declined, in one write (so the two can't disagree). The
move itself is checked by app/status.py. Repeating the same decision returns the application
unchanged; the opposite decision, or any application that isn't waiting for sign-off, is 409.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import BaseModel, Field, field_validator

from app import status as status_moves
from app.applications import ApplicationOut, _out, _update_if_unchanged
from app.auth import require_role
from app.firestore import db

router = APIRouter(prefix="/core", tags=["decision"])

STATUS_FOR = {"approved": "Underwriter Approved", "declined": "Declined"}


class DecisionIn(BaseModel):
    outcome: Literal["approved", "declined"]
    reason: str | None = Field(default=None, max_length=1000)

    @field_validator("reason")
    @classmethod
    def blank_is_none(cls, v):
        v = v.strip() if v else v
        return v or None


@router.post("/applications/{application_id}/decision", response_model=ApplicationOut)
def sign_off(application_id: str, body: DecisionIn, user: dict = Depends(require_role("underwriter"))):
    """Approve or decline an application that has been through the AI review.

    Any underwriter can sign off any application. The status moves to Underwriter Approved or
    Declined and the application gets a `decision` with the outcome, the underwriter's uid, the
    time and the reason (if one was given). The same call twice is safe; a different outcome
    after one is recorded is 409, as is any status other than AI Deliberated.
    """
    ref = db().collection("applications").document(application_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "No application with that id")
    doc, read_at = snap.to_dict(), snap.update_time

    target = STATUS_FOR[body.outcome]
    recorded = (doc.get("decision") or {}).get("outcome")
    if doc.get("status") == target and recorded == body.outcome:
        return _out(ref.id, doc)
    if doc.get("status") != "AI Deliberated":
        raise HTTPException(409, f"Only an application that is AI Deliberated can be signed off; this one is {doc.get('status')}")

    decision = {"outcome": body.outcome, "underwriterId": user["uid"], "decidedAt": SERVER_TIMESTAMP}
    if body.reason:
        decision["reason"] = body.reason
    changes = status_moves.plan_move(doc, target, status_moves.UNDERWRITER, user["uid"], extra={"decision": decision})
    _update_if_unchanged(ref, changes, read_at)
    return _out(ref.id, ref.get().to_dict())
