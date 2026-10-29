"""The application lifecycle: which status moves are allowed, who may make each, and the record it leaves.

Every endpoint that changes `status` builds its write with `plan_move`, so a move can't skip a step
or be made by the wrong actor, and each one is logged in `statusHistory`. The table is the one in
docs/api-design.md section 9 (agreed in the backlog review).
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from google.cloud.firestore import SERVER_TIMESTAMP, ArrayUnion

STATUSES = ("Draft", "Applied", "AI Deliberated", "Underwriter Approved", "Declined", "Funded", "Closed")

# Who makes a move: the borrower who owns the application, the AI committee when its run completes,
# an underwriter, or the mint confirmation once the loan note is on chain.
BORROWER, COMMITTEE, UNDERWRITER, MINT = "borrower", "committee", "underwriter", "mint"

MOVES = {
    ("Draft", "Applied"): BORROWER,
    ("Applied", "AI Deliberated"): COMMITTEE,
    ("AI Deliberated", "Underwriter Approved"): UNDERWRITER,
    ("AI Deliberated", "Declined"): UNDERWRITER,
    ("Underwriter Approved", "Funded"): MINT,
    ("Funded", "Closed"): UNDERWRITER,
    ("Declined", "Closed"): UNDERWRITER,
}


def plan_move(doc: dict, new_status: str, actor: str, actor_id: str, extra: dict | None = None, now: datetime | None = None) -> dict:
    """The Firestore changes that move `doc` to `new_status`, or an HTTP error if that isn't allowed.

    A move that isn't in the table is 409, whoever asks. A move that exists but belongs to another
    actor is 403. `actor_id` is the uid of the person, or the name of the service (for example
    `al-ai`). `extra` carries the other fields that change with the move, such as `submittedAt`.
    The caller writes the result with the conflict check, so the move only lands on the document it read.
    """
    current = doc.get("status")
    owner = MOVES.get((current, new_status))
    if owner is None:
        raise HTTPException(409, f"An application can't move from {current} to {new_status}")
    if owner != actor:
        raise HTTPException(403, f"Only the {owner} can move an application from {current} to {new_status}")
    entry = {"from": current, "to": new_status, "actor": actor, "actorId": actor_id, "at": now or datetime.now(timezone.utc)}
    return {"status": new_status, "updatedAt": SERVER_TIMESTAMP, "statusHistory": ArrayUnion([entry]), **(extra or {})}
