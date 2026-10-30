"""The one audit hash function. al-core uses it at mint and al-ai uses the same rules for its per-call hashes.

The rules are in SCHEMA.md (applications/{id}/audit/record) and the shared examples are in
test/audit-hash-vectors.json, which al-ai's tests load too.
"""

import hashlib
import json
from datetime import datetime, timezone


def utc_iso(moment: datetime) -> str:
    """A time in the one format hashed records use: UTC, milliseconds, a Z (2026-09-18T11:00:00.000Z).

    A naive datetime is taken to be UTC. Any other format changes the hash.
    """
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_json(record: dict) -> str:
    """The text that gets hashed: keys sorted, no spaces, without the record's own auditHash."""
    body = {key: value for key, value in record.items() if key != "auditHash"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"))


def audit_hash(record: dict) -> str:
    """SHA-256 (lower-case hex) of the canonical record. Times in it must already be utc_iso strings."""
    return hashlib.sha256(canonical_json(record).encode("utf-8")).hexdigest()


# ---- building the record (AL-172) ---------------------------------------------------------------------------------


class AuditRecordError(ValueError):
    """The stored documents can't make a valid audit record, so nothing is hashed or stored."""


def application_ref(application_id: str) -> str:
    """The on-chain reference for an application: SHA-256 of its id, lower-case hex, with no personal data in it.

    The loan note and the registry use the same one (chain/scripts/demo-mint.js), so one application has one reference.
    """
    return hashlib.sha256(application_id.encode("utf-8")).hexdigest()


def plain(value):
    """A Firestore document as plain JSON values: every time becomes a utc_iso string, because a timestamp read back
    does not hash the same as the one that was written (SCHEMA.md, applications/{id}/audit/record)."""
    if isinstance(value, datetime):
        return utc_iso(value)
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    return value


def call_hash(call: dict) -> str:
    """The hash of one ai_calls document, with its times as utc_iso strings (the same function as the record's)."""
    return audit_hash(plain(call))


def build_record(application_id: str, application: dict, run: dict, calls: list[tuple[str, dict]]) -> dict:
    """The audit record for a signed-off application, from the stored documents. Not yet hashed.

    `calls` is every ai_calls document of the run as (call id, document), in any order: they are listed oldest first,
    each with the hash of its document. Raises AuditRecordError for anything that can't make a record.
    """
    decision = application.get("decision") or {}
    if decision.get("outcome") != "approved":
        raise AuditRecordError("only an approved application has an audit record")
    for name in ("underwriterId", "decidedAt"):
        if not decision.get(name):
            raise AuditRecordError(f"the decision has no {name}")
    if not application.get("riskTier"):
        raise AuditRecordError("the application has no risk tier")
    if run.get("status") != "complete":
        raise AuditRecordError("the AI run is not complete")
    memo = run.get("creditMemo")
    if not isinstance(memo, str) or not memo.strip():
        raise AuditRecordError("the AI run has no credit memo")
    if not calls:
        raise AuditRecordError("the AI run has no logged calls")

    ordered = sorted(calls, key=lambda item: (utc_iso(item[1]["createdAt"]) if isinstance(item[1].get("createdAt"), datetime) else str(item[1].get("createdAt")), item[0]))
    return {
        "aiCalls": [{"id": call_id, "sha256": call_hash(doc)} for call_id, doc in ordered],
        "applicationId": application_id,
        "creditMemo": memo,
        "decision": decision["outcome"],
        "riskTier": application["riskTier"],
        "signedOffAt": plain(decision["decidedAt"]),
        "underwriterId": decision["underwriterId"],
    }
