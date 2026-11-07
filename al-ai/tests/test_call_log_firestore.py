"""The ai_calls documents against the real Firestore emulator (AL-140). They skip when FIRESTORE_EMULATOR_HOST is not set (CI has no emulator):

    cd al-core && firebase emulators:start --only firestore --project demo-al
    cd al-ai && FIRESTORE_EMULATOR_HOST=localhost:8080 uv run pytest tests/test_call_log_firestore.py

The providers are fake, so no key or model is used. Each test starts from an empty emulator.
"""

import os
import urllib.request
from datetime import UTC, datetime

import pytest
from google.cloud.firestore_v1.base_query import FieldFilter

import test_committee as tc
from app import call_log, committee
from app.call_log import AlreadyStored, CallLogError, FirestoreSink

EMULATOR = os.getenv("FIRESTORE_EMULATOR_HOST")
pytestmark = pytest.mark.skipif(not EMULATOR, reason="needs the Firestore emulator (set FIRESTORE_EMULATOR_HOST)")


@pytest.fixture
def db():
    from google.cloud import firestore

    request = urllib.request.Request(f"http://{EMULATOR}/emulator/v1/projects/demo-al/databases/(default)/documents", method="DELETE")
    urllib.request.urlopen(request).read()  # empty the emulator so one test never sees another's documents
    return firestore.Client(project="demo-al")


def test_a_document_is_created_once_and_never_replaced(db):
    sink = FirestoreSink(db)
    first = {"runId": "r", "outcome": "ok", "createdAt": datetime(2026, 11, 7, 10, 0, tzinfo=UTC)}
    sink.create("r-affordability-1", first)
    with pytest.raises(AlreadyStored):
        sink.create("r-affordability-1", {**first, "outcome": "changed"})
    assert sink.get("r-affordability-1")["outcome"] == "ok"
    assert sink.get("nope") is None


def test_saving_the_same_call_again_and_a_different_call_under_the_same_id(db):
    sink = FirestoreSink(db)
    doc = {"runId": "r", "outcome": "ok", "createdAt": datetime(2026, 11, 7, 10, 0, 0, 123000, tzinfo=UTC)}
    call_log.save(sink, "r-strategist-1", doc)
    call_log.save(sink, "r-strategist-1", doc)  # a lost answer: the stored document equals this one, so it is not an error
    with pytest.raises(CallLogError, match="different call"):
        call_log.save(sink, "r-strategist-1", {**doc, "outcome": "provider_error"})
    assert sink.get("r-strategist-1")["outcome"] == "ok"


def test_a_whole_committee_run_leaves_its_calls_where_the_run_can_be_found(db):
    deps = committee.Deps(
        store=tc.MemoryRunStore(), report_store=tc.a_report_for_today(), official=tc.OFFICIAL, benchmark_rate_pct=4.0, today=tc.TODAY,
        agents=tc.AGENTS, transport=tc.Providers(), env=tc.ENV, sleep=lambda s: None, call_sink=FirestoreSink(db),
    )
    record = committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1", run_id="run-live")
    stored = {snap.id: snap.to_dict() for snap in db.collection("ai_calls").where(filter=FieldFilter("runId", "==", "run-live")).stream()}
    assert {call["id"] for call in record["ai_calls"]} <= set(stored)
    assert set(stored) == {f"run-live-{step}-1" for step in ("affordability", "valuation_agent", "strategist", "valuation_model")} | {"run-live-market-reused"}
    doc = stored["run-live-affordability-1"]
    assert (doc["applicationId"], doc["brokerId"], doc["agent"], doc["outcome"]) == ("app-1", tc.MORTGAGE["brokerId"], "affordability", "ok")
    assert isinstance(doc["createdAt"], datetime) and doc["createdAt"].tzinfo and isinstance(doc["latencyMs"], int)
    assert doc["request"]["prompt"] and doc["parsedReply"] == tc.AFFORDABILITY
    # a broker's list query filters on brokerId, so every document must carry it
    mine = db.collection("ai_calls").where(filter=FieldFilter("brokerId", "==", tc.MORTGAGE["brokerId"])).stream()
    assert len(list(mine)) == len(stored)


def test_a_run_that_is_run_twice_with_the_same_ids_does_not_overwrite_the_first_calls(db):
    sink = FirestoreSink(db)

    def once(providers):
        deps = committee.Deps(
            store=tc.MemoryRunStore(), report_store=tc.a_report_for_today(), official=tc.OFFICIAL, benchmark_rate_pct=4.0, today=tc.TODAY,
            agents=tc.AGENTS, transport=providers, env=tc.ENV, sleep=lambda s: None, call_sink=sink,
        )
        return committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1", run_id="run-twice")

    once(tc.Providers())
    first = sink.get("run-twice-affordability-1")
    second = once(tc.Providers(ollama={**tc.AFFORDABILITY, "rating": "strong"}))  # the same run id again: a different answer must not replace the stored call
    assert sink.get("run-twice-affordability-1") == first
    assert second["status"] == "failed" and "different call" in second["failure_reason"]
