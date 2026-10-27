import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.audit import audit_hash, canonical_json, utc_iso

VECTORS = json.loads((Path(__file__).parent.parent / "test" / "audit-hash-vectors.json").read_text())["vectors"]


def test_the_vector_file_has_the_seeds_audit_records_and_ai_calls():
    names = [v["name"] for v in VECTORS]
    assert any(n.startswith("audit-record:") for n in names)
    assert any(n.startswith("ai-call:") for n in names)


@pytest.mark.parametrize("vector", VECTORS, ids=[v["name"] for v in VECTORS])
def test_matches_every_hash_the_seed_writes(vector):
    assert audit_hash(vector["record"]) == vector["hash"]


def test_a_record_that_carries_its_own_audit_hash_hashes_the_same():
    vector = next(v for v in VECTORS if v["name"].startswith("audit-record:"))
    assert audit_hash({**vector["record"], "auditHash": "anything"}) == vector["hash"]


def test_key_order_does_not_matter():
    assert audit_hash({"a": 1, "b": [1, 2]}) == audit_hash({"b": [1, 2], "a": 1})


def test_the_hashed_text_is_sorted_and_compact():
    assert canonical_json({"b": "x", "a": 1}) == '{"a":1,"b":"x"}'


def test_changing_one_character_changes_the_hash():
    vector = next(v for v in VECTORS if v["name"].startswith("audit-record:"))
    changed = {**vector["record"], "creditMemo": vector["record"]["creditMemo"] + "."}
    assert audit_hash(changed) != vector["hash"]


def test_a_known_hash_by_hand():
    # sha256 of the text {"a":1}
    assert audit_hash({"a": 1}) == "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"


def test_times_use_utc_milliseconds_and_a_z():
    assert utc_iso(datetime(2026, 9, 18, 11, 0, tzinfo=timezone.utc)) == "2026-09-18T11:00:00.000Z"
    assert utc_iso(datetime(2026, 9, 18, 12, 0, 0, 123000, tzinfo=timezone(timedelta(hours=1)))) == "2026-09-18T11:00:00.123Z"
    assert utc_iso(datetime(2026, 9, 18, 11, 0)) == "2026-09-18T11:00:00.000Z"
