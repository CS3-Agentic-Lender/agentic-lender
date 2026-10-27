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
