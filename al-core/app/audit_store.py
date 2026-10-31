"""Anchor a signed-off application's decision: build its audit record, save it, put its hash on the registry, keep the transaction.

`anchor` is what the mint step calls once the underwriter has signed off (the loan note also stores this hash):

1. read the application and its latest complete AI run with every logged call (the documents the underwriter judged);
2. build the audit record and hash it (app/audit.py, the one shared function);
3. save the record with its `auditHash` at applications/{id}/audit/record, never replacing a record with another hash;
4. write the hash to the registry (app/chain.py), which accepts it once;
5. keep the transaction hash on the application as `auditTxHash`.

It is safe to call again: the same record gives the same hash, the registry answers "already stored", and nothing is rewritten.
The order matters. The record is saved before the chain write, so a crash in between leaves a record that a retry anchors; a
retry after a crash that came after the chain write finds the hash stored and leaves `auditTxHash` as it was.
"""

from dataclasses import dataclass

from google.cloud.firestore import SERVER_TIMESTAMP
from google.cloud.firestore_v1.base_query import FieldFilter

from app import audit
from app.audit import AuditRecordError
from app.chain import AuditRegistry
from app.firestore import db


@dataclass(frozen=True)
class Anchored:
    record: dict
    audit_hash: str
    tx_hash: str | None  # None when the registry already held this hash
    already_stored: bool


def _latest_complete_run(application_id: str) -> tuple[str, dict]:
    runs = [
        (snap.id, snap.to_dict())
        for snap in db().collection("ai_runs").where(filter=FieldFilter("applicationId", "==", application_id)).stream()
    ]
    complete = [(run_id, run) for run_id, run in runs if run.get("status") == "complete"]
    if not complete:
        raise AuditRecordError("the application has no complete AI run")
    return max(complete, key=lambda item: (audit.plain(item[1].get("startedAt")) or "", item[0]))


def anchor(application_id: str, registry: AuditRegistry) -> Anchored:
    ref = db().collection("applications").document(application_id)
    snap = ref.get()
    if not snap.exists:
        raise AuditRecordError("No application with that id")
    application = snap.to_dict()

    run_id, run = _latest_complete_run(application_id)
    calls = [
        (call.id, call.to_dict())
        for call in db().collection("ai_calls").where(filter=FieldFilter("runId", "==", run_id)).stream()
    ]
    record = audit.build_record(application_id, application, run, calls)
    audit_hash = audit.audit_hash(record)

    saved = ref.collection("audit").document("record")
    existing = saved.get()
    if existing.exists:
        if existing.to_dict().get("auditHash") != audit_hash:
            raise AuditRecordError("an audit record with a different hash is already saved for this application")
    else:
        saved.set({**record, "auditHash": audit_hash})

    stored = registry.store(application_id, audit_hash)
    if stored.tx_hash:
        ref.update({"auditTxHash": stored.tx_hash, "updatedAt": SERVER_TIMESTAMP})
    return Anchored(record, audit_hash, stored.tx_hash, stored.already_stored)
