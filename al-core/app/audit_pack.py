"""GET /core/applications/{id}/audit-pack returns everything an audit pack needs for a decision, from the one stored record.

The PDF, the CSV and the on-chain hash all come from this one response, so they can't disagree. It holds:

- `record` and `audit_hash`: the audit record exactly as it is stored and hashed (app/audit.py), without its own `auditHash`, so a
  reader can hash it as it is (`audit.audit_hash`) and compare;
- the context a person reads, from the documents behind the decision: the application summary with its decision and loan note,
  the valuation, the affordability figures, what the policy gate said, every agent call the record lists, and both transaction
  hashes (the mint's, in `application.loan_note.tx_hash`, and the audit hash's, `audit_tx_hash`);
- `verification`: the record's hash worked out again here, next to the stored one, the loan note's one, and, when a chain is
  configured, the registry's. `verified` is true only when every hash that could be checked agrees.

Underwriters and the assigned broker only: a borrower is 403, and another broker's application is 404 like everywhere else. An
application has a pack once its loan note is minted; before that it is 409.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel

from app import audit
from app.applications import ApplicationOut, _iso, _out
from app.auth import require_role
from app.chain import AuditRegistry, ChainError, NotConfigured
from app.firestore import db

router = APIRouter(prefix="/core", tags=["audit pack"])
log = logging.getLogger("al-core.audit_pack")


class AgentCallOut(BaseModel):
    id: str
    agent: str | None = None
    provider: str | None = None
    model: str | None = None
    output: str | None = None
    created_at: str | None = None
    sha256: str  # the hash the record lists for this call
    matches: bool  # whether the stored call, hashed again, gives that hash


class VerificationOut(BaseModel):
    computed_hash: str  # the record as returned, hashed here
    stored_hash: str  # the `auditHash` saved with the record
    loan_note_hash: str | None = None  # the hash the loan note was minted with
    on_chain_hash: str | None = None  # what the registry holds; null if no chain is set up here or it can't be reached
    on_chain_checked: bool
    calls_match: bool  # every call the record lists exists and hashes to what the record says
    verified: bool  # computed == stored == loan note, == the registry's when checked, and the calls match


class AuditPackOut(BaseModel):
    application_id: str
    audit_hash: str
    record: dict
    application: ApplicationOut
    valuation: dict | None = None
    affordability: dict | None = None
    policy_gate: dict | None = None
    agent_calls: list[AgentCallOut]
    audit_tx_hash: str | None = None
    verification: VerificationOut


def _registry() -> AuditRegistry | None:
    """The audit registry if this server has chain settings, else None (the pack is then built without the chain's answer)."""
    try:
        return AuditRegistry.from_env()
    except NotConfigured:
        return None


def _on_chain_hash(application_id: str) -> tuple[str | None, bool]:
    """(the registry's hash for the application, whether the registry could be asked). A chain that is down is not an error here."""
    registry = _registry()
    if registry is None:
        return None, False
    try:
        stored = registry.record_of(application_id)
    except ChainError as exc:
        log.warning("The audit registry could not be read for the audit pack of %s: %s", application_id, exc)
        return None, False
    return (stored[0] if stored else None), True


def _agent_calls(record: dict) -> list[dict]:
    calls = []
    for entry in record.get("aiCalls", []):
        snap = db().collection("ai_calls").document(entry["id"]).get()
        doc = snap.to_dict() if snap.exists else None
        calls.append({
            "id": entry["id"],
            "agent": doc.get("agent") if doc else None,
            "provider": doc.get("provider") if doc else None,
            "model": doc.get("model") if doc else None,
            "output": doc.get("output") if doc else None,
            "created_at": _iso(doc.get("createdAt")) if doc else None,
            "sha256": entry["sha256"],
            "matches": bool(doc) and audit.call_hash(doc) == entry["sha256"],
        })
    return calls


@router.get("/applications/{application_id}/audit-pack", response_model=AuditPackOut)
def audit_pack(application_id: str, user: dict = Depends(require_role("underwriter", "broker"))):
    """The audit pack for a decision: the stored audit record and its hash, the documents behind it, and a check that they agree.

    An underwriter can read any; a broker only an application assigned to them (anything else is 404). 409 until the loan
    note is minted, since the audit record is made then.
    """
    ref = db().collection("applications").document(application_id)
    snap = ref.get()
    if not snap.exists or (user.get("role") == "broker" and snap.to_dict().get("brokerId") != user["uid"]):
        raise HTTPException(404, "No application with that id")  # the same answer for a missing id and someone else's application
    application = snap.to_dict()

    saved = ref.collection("audit").document("record").get()
    if not application.get("loanNote") or not saved.exists:
        raise HTTPException(409, f"An audit pack is available once the loan note is minted; this application is {application.get('status')}")
    stored = saved.to_dict()
    record = {key: value for key, value in stored.items() if key != "auditHash"}
    computed = audit.audit_hash(record)

    review = ref.collection("review").document("underwriting").get()
    review_doc = audit.plain(review.to_dict()) if review.exists else {}
    calls = _agent_calls(record)

    on_chain, checked = _on_chain_hash(application_id)
    loan_note_hash = (application.get("loanNote") or {}).get("auditHash")
    stored_hash = stored.get("auditHash", "")
    calls_match = all(call["matches"] for call in calls)
    hashes = [stored_hash, loan_note_hash] + ([on_chain] if checked else [])
    verified = calls_match and all(computed == value for value in hashes)

    return {
        "application_id": ref.id,
        "audit_hash": stored_hash,
        "record": record,
        "application": _out(ref.id, application),
        "valuation": review_doc.get("valuationDetail"),
        "affordability": review_doc.get("dtiBreakdown"),
        "policy_gate": review_doc.get("policyGate"),
        "agent_calls": calls,
        "audit_tx_hash": application.get("auditTxHash"),
        "verification": {
            "computed_hash": computed,
            "stored_hash": stored_hash,
            "loan_note_hash": loan_note_hash,
            "on_chain_hash": on_chain,
            "on_chain_checked": checked,
            "calls_match": calls_match,
            "verified": verified,
        },
    }
