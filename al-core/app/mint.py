"""POST /core/applications/{id}/mint puts an approved loan on the chain as a loan note.

An underwriter calls it for an application that is Underwriter Approved. It anchors the decision's audit hash on the registry
(app/audit_store.py), mints the loan note (app/loan_notes.py), and then saves the note on the application and moves the status to
Funded in one guarded write, so the two can't disagree. If the chain fails, nothing is saved and the status stays Underwriter
Approved, so the underwriter can call it again. Calling it again is always safe: the registry and the contract each accept an
application once, and both hand back what is already there, so a mint that reached the chain but not Firestore is finished by
the retry and never repeated. A Funded application answers 200 with the note it has.
"""

import os
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from google.cloud.firestore import SERVER_TIMESTAMP

from app import audit_store
from app import status as status_moves
from app.applications import ApplicationOut, _out, _update_if_unchanged
from app.audit import AuditRecordError
from app.auth import require_role
from app.chain import AuditRegistry, ChainError, NotConfigured
from app.firestore import db
from app.loan_notes import LoanNotes, NoteTerms, borrower_ref

router = APIRouter(prefix="/core", tags=["mint"])

MAX_TERM_MONTHS = 480  # the contract's limit
MAX_APR_BPS = 10_000


def audit_registry() -> AuditRegistry:
    try:
        return AuditRegistry.from_env()
    except NotConfigured as exc:
        raise HTTPException(503, f"The blockchain is not set up on this server: {exc}")


def loan_notes() -> LoanNotes:
    try:
        return LoanNotes.from_env()
    except NotConfigured as exc:
        raise HTTPException(503, f"The blockchain is not set up on this server: {exc}")


def _apr_pct(ref, doc: dict) -> float | None:
    """The rate on the note: the application's `aprPct`, which until pricing exists is the benchmark rate its DTI was worked out at."""
    if doc.get("aprPct") is not None:
        return doc["aprPct"]
    review = ref.collection("review").document("underwriting").get()
    breakdown = (review.to_dict() or {}).get("dtiBreakdown") if review.exists else None
    return (breakdown or {}).get("benchmarkRatePct")


def _scaled(value) -> int:
    """A euro amount as cents, or a percentage as basis points: times 100, halves rounded up, with no float slips."""
    return int((Decimal(str(value)) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _terms(ref, doc: dict) -> NoteTerms:
    """The note's terms from the stored application, or a 409 saying what is missing (the chain is not touched)."""
    amount, years, apr = doc.get("loanAmountEur"), doc.get("termYears"), _apr_pct(ref, doc)
    if not amount or amount <= 0:
        raise HTTPException(409, "The application has no loan amount to put on a loan note")
    if not years or years <= 0:
        raise HTTPException(409, "The application has no term to put on a loan note")
    if apr is None:
        raise HTTPException(409, "The application has no rate yet (aprPct or the DTI breakdown's benchmark rate), so a loan note can't be minted")
    term_months, apr_bps = int(years) * 12, _scaled(apr)
    if term_months > MAX_TERM_MONTHS:
        raise HTTPException(409, f"A loan note can't have a term over {MAX_TERM_MONTHS // 12} years")
    if not 0 <= apr_bps <= MAX_APR_BPS:
        raise HTTPException(409, "A loan note's rate must be between 0% and 100%")
    try:
        borrower = borrower_ref(doc["borrowerId"], os.environ.get("BORROWER_REF_SALT", ""))
    except NotConfigured as exc:
        raise HTTPException(503, f"The blockchain is not set up on this server: {exc}")
    return NoteTerms(
        principal_cents=_scaled(amount), apr_bps=apr_bps, term_months=term_months,
        loan_type=doc.get("loanType", "mortgage"), borrower_ref=borrower,
    )


@router.post("/applications/{application_id}/mint", response_model=ApplicationOut, status_code=201)
def mint_loan_note(application_id: str, response: Response, user: dict = Depends(require_role("underwriter"))):
    """Mint the loan note for an Underwriter Approved application and move it to Funded.

    201 with the application and its `loan_note` the first time; 200 with the same note if it is already Funded. Any other
    status is 409, as is an application that is missing its amount, term or rate, or has no complete AI run to hash. A chain that
    is down or refuses is 502 and the application stays Underwriter Approved. A server without chain settings is 503.
    """
    ref = db().collection("applications").document(application_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "No application with that id")
    doc = snap.to_dict()
    if doc.get("status") == "Funded" and doc.get("loanNote"):
        response.status_code = 200
        return _out(ref.id, doc)
    if doc.get("status") != "Underwriter Approved":
        raise HTTPException(409, f"Only an application that is Underwriter Approved can be minted; this one is {doc.get('status')}")

    terms = _terms(ref, doc)
    registry, notes = audit_registry(), loan_notes()
    try:
        anchored = audit_store.anchor(application_id, registry)
        minted = notes.mint(application_id, terms)
    except AuditRecordError as exc:
        raise HTTPException(409, str(exc))
    except ChainError as exc:
        raise HTTPException(502, str(exc))

    # The anchor wrote auditTxHash to the application, so read it again for the guarded write, and see whether a
    # concurrent call has already finished the job.
    snap = ref.get()
    doc, read_at = snap.to_dict(), snap.update_time
    if doc.get("status") == "Funded" and doc.get("loanNote"):
        response.status_code = 200
        return _out(ref.id, doc)
    note = {
        "tokenId": str(minted.token_id), "contractAddress": minted.contract_address, "txHash": minted.tx_hash,
        "auditHash": anchored.audit_hash, "mintedAt": SERVER_TIMESTAMP,
    }
    extra = {"loanNote": note}
    if doc.get("aprPct") is None:
        # The rate came from the DTI breakdown, which a borrower can't read. Saving what went on the chain as aprPct, in the
        # same write as the note, means the application always shows the rate its loan note holds.
        extra["aprPct"] = terms.apr_bps / 100
    changes = status_moves.plan_move(doc, "Funded", status_moves.MINT, user["uid"], extra=extra)
    _update_if_unchanged(ref, changes, read_at)
    return _out(ref.id, ref.get().to_dict())
