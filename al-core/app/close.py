"""POST /core/applications/{id}/close ends a funded or declined loan.

An underwriter calls it for an application that is Funded or Declined. A Funded loan has a loan note, so the note is closed on
the chain first (app/loan_notes.py) and then the status moves to Closed, with the note's `closedAt` and `closeTxHash`, in one
guarded write, so the chain and Firestore can't disagree. A Declined application has no note and touches no chain. If the chain
fails, nothing is saved and the status stays Funded, so the underwriter can call it again. Calling it again is always safe: the
contract closes a note once, so a close that reached the chain but not Firestore is finished by the retry and never repeated.
A Closed application answers 200 with what it has and sends nothing.
"""

from fastapi import APIRouter, Depends, HTTPException

from app import status as status_moves
from app.applications import ApplicationOut, _out, _update_if_unchanged
from app.auth import require_role
from app.chain import ChainError
from app.firestore import db
from app.mint import loan_notes

router = APIRouter(prefix="/core", tags=["close"])


@router.post("/applications/{application_id}/close", response_model=ApplicationOut)
def close_application(application_id: str, user: dict = Depends(require_role("underwriter"))):
    """Close a Funded or Declined application. Always 200 with the application, whether it was closed now or before.

    Any other status is 409. A Funded application with no loan note is 409 too, since there is nothing to close on the chain.
    A chain that is down or refuses is 502 and the application stays Funded. A server without chain settings is 503.
    """
    ref = db().collection("applications").document(application_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "No application with that id")
    doc, read_at = snap.to_dict(), snap.update_time
    status = doc.get("status")
    if status == "Closed":
        return _out(ref.id, doc)
    if status not in ("Funded", "Declined"):
        raise HTTPException(409, f"Only an application that is Funded or Declined can be closed; this one is {status}")

    extra = {}
    if status == "Funded":
        if not doc.get("loanNote"):
            raise HTTPException(409, "The application has no loan note to close")
        notes = loan_notes()
        try:
            closed = notes.close(application_id)
        except ChainError as exc:
            raise HTTPException(502, str(exc))
        # Read again for the guarded write, and see whether a concurrent call has already finished the job.
        snap = ref.get()
        doc, read_at = snap.to_dict(), snap.update_time
        if doc.get("status") == "Closed":
            return _out(ref.id, doc)
        extra = {"loanNote.closedAt": closed.closed_at, "loanNote.closeTxHash": closed.tx_hash}

    changes = status_moves.plan_move(doc, "Closed", status_moves.UNDERWRITER, user["uid"], extra=extra)
    _update_if_unchanged(ref, changes, read_at)
    return _out(ref.id, ref.get().to_dict())
