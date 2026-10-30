"""Building the audit record from stored documents (AL-172). The seeded app-funded record and its hash are the shared vectors
that al-ai's tests load too, so the builder must reproduce them from the raw documents."""

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import audit
from app.audit import AuditRecordError

VECTORS = json.loads((Path(__file__).resolve().parent.parent / "test" / "audit-hash-vectors.json").read_text(encoding="utf-8"))["vectors"]
FUNDED = next(v for v in VECTORS if v["name"] == "audit-record:app-funded")


def as_datetime(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def funded_inputs():
    """The documents Firestore would hold for app-funded: times as datetimes, the calls with their own ids."""
    record = FUNDED["record"]
    calls = []
    for vector in VECTORS:
        if vector["name"].startswith("ai-call:call-app-funded"):
            doc = dict(vector["record"])
            doc["createdAt"] = as_datetime(doc["createdAt"])
            calls.append((vector["name"].split(":", 1)[1], doc))
    application = {
        "riskTier": record["riskTier"],
        "decision": {"outcome": "approved", "underwriterId": record["underwriterId"], "decidedAt": as_datetime(record["signedOffAt"]), "reason": "Strong affordability"},
    }
    run = {"status": "complete", "creditMemo": record["creditMemo"]}
    return application, run, calls


def build(**changes):
    application, run, calls = funded_inputs()
    application = {**application, **changes.pop("application", {})}
    run = {**run, **changes.pop("run", {})}
    return audit.build_record("app-funded", application, run, changes.pop("calls", calls))


def test_the_seeded_record_and_its_hash_are_rebuilt_from_the_raw_documents():
    record = build()
    assert record == FUNDED["record"]
    assert audit.audit_hash(record) == FUNDED["hash"]


def test_the_order_the_calls_are_read_in_does_not_matter():
    _, _, calls = funded_inputs()
    assert audit.audit_hash(build(calls=list(reversed(calls)))) == FUNDED["hash"]


def test_calls_are_listed_oldest_first_and_a_tie_goes_by_id():
    t = datetime(2026, 9, 18, 10, 0, tzinfo=timezone.utc)
    calls = [("b", {"createdAt": t, "x": 1}), ("a", {"createdAt": t, "x": 2}), ("c", {"createdAt": t - timedelta(minutes=1), "x": 3})]
    assert [c["id"] for c in build(calls=calls)["aiCalls"]] == ["c", "a", "b"]


def test_a_call_is_hashed_with_its_times_as_utc_iso_strings():
    t = datetime(2026, 9, 18, 10, 0, 0, 250000, tzinfo=timezone.utc)
    (entry,) = build(calls=[("c1", {"createdAt": t, "agent": "valuation"})])["aiCalls"]
    assert entry["sha256"] == audit.audit_hash({"createdAt": "2026-09-18T10:00:00.250Z", "agent": "valuation"})


def test_the_record_has_exactly_the_agreed_fields_and_no_hash_of_its_own():
    assert sorted(build()) == ["aiCalls", "applicationId", "creditMemo", "decision", "riskTier", "signedOffAt", "underwriterId"]


def test_the_same_record_always_gives_the_same_hash():
    assert audit.audit_hash(build()) == audit.audit_hash(build())


def test_changing_one_character_changes_the_hash():
    changed = audit.audit_hash(build(run={"creditMemo": FUNDED["record"]["creditMemo"].replace("approve", "approvf")}))
    assert changed != FUNDED["hash"]
    assert audit.audit_hash(build(application={"riskTier": "B"})) != FUNDED["hash"]


def test_a_time_with_another_offset_is_written_in_utc():
    local = datetime(2026, 9, 18, 12, 0, tzinfo=timezone(timedelta(hours=1)))
    decision = {**funded_inputs()[0]["decision"], "decidedAt": local}
    assert build(application={"decision": decision})["signedOffAt"] == "2026-09-18T11:00:00.000Z"


# ---- the on-chain reference -----------------------------------------------------------------------------------------


def test_the_application_reference_is_the_sha256_of_the_id_in_lower_case_hex():
    ref = audit.application_ref("app-funded")
    assert ref == hashlib.sha256(b"app-funded").hexdigest()
    assert len(ref) == 64 and ref == ref.lower()
    assert "app-funded" not in ref


def test_plain_turns_every_nested_time_into_a_string_and_leaves_the_rest():
    t = datetime(2026, 9, 18, 10, 0, tzinfo=timezone.utc)
    assert audit.plain({"a": t, "b": [t, {"c": t}], "n": 1, "s": "x", "none": None}) == {
        "a": "2026-09-18T10:00:00.000Z", "b": ["2026-09-18T10:00:00.000Z", {"c": "2026-09-18T10:00:00.000Z"}], "n": 1, "s": "x", "none": None,
    }


# ---- what can't make a record ---------------------------------------------------------------------------------------


def broken_decision(**changes):
    decision = {**funded_inputs()[0]["decision"], **changes}
    return {"decision": decision}


@pytest.mark.parametrize(
    "changes",
    [
        {"application": {"decision": None}},
        {"application": broken_decision(outcome="declined")},
        {"application": broken_decision(underwriterId="")},
        {"application": broken_decision(decidedAt=None)},
        {"application": {"riskTier": None}},
        {"run": {"status": "running"}},
        {"run": {"status": "failed"}},
        {"run": {"creditMemo": None}},
        {"run": {"creditMemo": "   "}},
        {"calls": []},
    ],
)
def test_anything_that_cannot_make_a_record_is_refused(changes):
    with pytest.raises(AuditRecordError):
        build(**changes)
