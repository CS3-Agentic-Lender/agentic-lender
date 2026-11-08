"""The committee starts by itself when an application becomes Applied (AL-141), against the Firestore emulator.

These need the emulator, so they skip when FIRESTORE_EMULATOR_HOST is not set (CI has no emulator, see docs/infrastructure.md):

    cd al-core && firebase emulators:start --only firestore --project demo-al        # port 8080 by default
    cd al-ai && FIRESTORE_EMULATOR_HOST=localhost:8080 uv run pytest tests/test_auto_start.py

The providers are fake (the same fake network as the committee tests), so no key or model is used. Each test starts from an empty emulator.
"""

import copy
import os
import threading
import time
import urllib.request
import uuid
from datetime import datetime

import pytest
from google.cloud.firestore_v1.base_query import FieldFilter

import test_committee as tc
from app import auto_start, committee

EMULATOR = os.getenv("FIRESTORE_EMULATOR_HOST")
pytestmark = pytest.mark.skipif(not EMULATOR, reason="needs the Firestore emulator (set FIRESTORE_EMULATOR_HOST)")


@pytest.fixture
def db():
    from google.cloud import firestore

    request = urllib.request.Request(f"http://{EMULATOR}/emulator/v1/projects/demo-al/databases/(default)/documents", method="DELETE")
    urllib.request.urlopen(request).read()  # empty the emulator so one test never sees another's applications
    return firestore.Client(project="demo-al")


def applied(db, **changes) -> str:
    """Put an Applied application in Firestore, in the layout of SCHEMA.md (the committee sample is that layout), and return its id."""
    application_id = f"app-{uuid.uuid4().hex[:8]}"
    document = {**copy.deepcopy(tc.MORTGAGE), "status": "Applied", "borrowerId": "borrower-1", "brokerId": "broker-1", **changes}
    document = {key: value for key, value in document.items() if value is not None}
    db.collection("applications").document(application_id).set(document)
    return application_id


def factory(providers=None):
    providers = providers or tc.Providers()

    def make(store):
        return committee.Deps(
            store=store, report_store=tc.a_report_for_today(), get_rate=tc.get_rate, today=tc.TODAY,
            agents=tc.AGENTS, transport=providers, env=tc.ENV, sleep=lambda seconds: None,
            search=lambda *a, **k: pytest.fail("the day's report exists, so no search should run"),
        )

    return make


def application(db, application_id):
    return db.collection("applications").document(application_id).get().to_dict()


def runs_for(db, application_id):
    return [doc.to_dict() | {"id": doc.id} for doc in db.collection("ai_runs").where(filter=FieldFilter("applicationId", "==", application_id)).stream()]


# ---- criterion 1 and 4: one run, claimed in a transaction -------------------------------------

def test_claiming_an_applied_application_marks_it_running_and_writes_the_base_run_document(db):
    application_id = applied(db)
    got = auto_start.claim(db, application_id, run_id="run-1")
    assert got["status"] == "Applied"
    stored = application(db, application_id)
    assert (stored["aiRunStatus"], stored["aiRunId"], stored["status"]) == ("running", "run-1", "Applied")
    run = db.collection("ai_runs").document("run-1").get().to_dict()
    assert run["applicationId"] == application_id and run["brokerId"] == "broker-1"
    assert (run["status"], run["trigger"], run["rerunOf"]) == ("running", "submit", None)
    assert isinstance(run["startedAt"], datetime) and run["finishedAt"] is None
    assert set(run) == {"applicationId", "brokerId", "status", "trigger", "rerunOf", "startedAt", "finishedAt", "failedStep", "failureReason"}


def test_a_second_trigger_for_the_same_application_starts_no_second_run(db):
    application_id = applied(db)
    assert auto_start.claim(db, application_id, run_id="run-1") is not None
    assert auto_start.claim(db, application_id, run_id="run-2") is None
    assert [run["id"] for run in runs_for(db, application_id)] == ["run-1"]


def test_two_claims_at_the_same_moment_have_exactly_one_winner(db):
    application_id = applied(db)
    won, barrier = [], threading.Barrier(4)

    def try_to_claim(n):
        barrier.wait()
        won.append(auto_start.claim(db, application_id, run_id=f"run-{n}") is not None)

    threads = [threading.Thread(target=try_to_claim, args=(n,)) for n in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert won.count(True) == 1
    assert len(runs_for(db, application_id)) == 1


@pytest.mark.parametrize("status", ["Draft", "AI Deliberated", "Underwriter Approved", "Declined"])
def test_an_application_that_is_not_applied_is_not_claimed(db, status):
    application_id = applied(db, status=status)
    assert auto_start.claim(db, application_id, run_id="run-1") is None
    assert runs_for(db, application_id) == [] and "aiRunStatus" not in application(db, application_id)


def test_an_application_that_does_not_exist_is_not_claimed(db):
    assert auto_start.claim(db, "nope", run_id="run-1") is None
    assert runs_for(db, "nope") == []


@pytest.mark.parametrize("ai_run_status", ["running", "complete", "failed"])
def test_the_listener_never_claims_an_application_that_has_already_had_a_run(db, ai_run_status):
    """`failed` is in the list on purpose: a failed run is re-run on purpose, not started again by the next change to the document (that would loop on an outage)."""
    application_id = applied(db, aiRunStatus=ai_run_status, aiRunId="run-0")
    assert auto_start.claim(db, application_id, run_id="run-1") is None


def test_the_claim_writes_the_extra_fields_in_the_same_transaction(db):
    """The place the approval likelihood fields go (AL-63): worked out from the application the claim read, and written with it or not at all."""
    seen = []

    def fields(data):
        seen.append(data["loanAmountEur"])
        return {"approvalLikelihood": "High"}

    application_id = applied(db)
    auto_start.claim(db, application_id, run_id="run-1", extra_fields=fields)
    assert application(db, application_id)["approvalLikelihood"] == "High"
    assert seen == [tc.MORTGAGE["loanAmountEur"]]
    other = applied(db, status="Draft")
    auto_start.claim(db, other, run_id="run-2", extra_fields=fields)
    assert "approvalLikelihood" not in application(db, other)
    assert len(seen) == 1  # a claim that is refused works nothing out


# ---- criterion 3: a complete run moves the status, a failed run leaves it ------------------------

def test_a_complete_run_moves_the_application_to_ai_deliberated_with_a_status_history_entry(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete"
    stored = application(db, application_id)
    assert (stored["status"], stored["aiRunStatus"], stored["aiRunId"]) == ("AI Deliberated", "complete", record["run_id"])
    [entry] = stored["statusHistory"]
    assert set(entry) == {"from", "to", "actor", "actorId", "at"}
    assert (entry["from"], entry["to"], entry["actor"], entry["actorId"]) == ("Applied", "AI Deliberated", "committee", "al-ai")
    assert isinstance(entry["at"], datetime)
    [run] = runs_for(db, application_id)
    assert (run["id"], run["status"], run["failedStep"], run["failureReason"]) == (record["run_id"], "complete", None, None)
    assert isinstance(run["finishedAt"], datetime)


def test_the_status_history_entry_is_added_to_the_ones_already_there(db):
    earlier = {"from": "Draft", "to": "Applied", "actor": "borrower", "actorId": "borrower-1", "at": datetime(2026, 11, 1, 9, 0, tzinfo=auto_start.UTC)}
    application_id = applied(db, statusHistory=[earlier])
    auto_start.process(db, application_id, deps_factory=factory())
    history = application(db, application_id)["statusHistory"]
    assert [entry["to"] for entry in history] == ["Applied", "AI Deliberated"]


def test_a_failed_run_leaves_the_application_applied_with_no_history_entry_and_the_reason_on_the_run(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory(tc.Providers(ollama=(500, b"boom"))))
    assert record["status"] == "failed"
    stored = application(db, application_id)
    assert (stored["status"], stored["aiRunStatus"]) == ("Applied", "failed")
    assert "statusHistory" not in stored
    assert not [key for key in stored if "ailure" in key or "eason" in key]  # a borrower can read this document: no reason on it
    [run] = runs_for(db, application_id)
    assert (run["status"], run["failedStep"]) == ("failed", "affordability")
    assert run["failureReason"] and isinstance(run["finishedAt"], datetime)


def test_an_application_the_committee_cannot_read_fails_at_validate_and_is_not_left_running(db):
    application_id = applied(db, grossIncomeEur=-1)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["failed_step"] == "validate"
    assert application(db, application_id)["aiRunStatus"] == "failed"
    assert runs_for(db, application_id)[0]["failedStep"] == "validate"


def test_a_crash_outside_the_steps_still_ends_the_run_as_failed(db):
    application_id = applied(db)

    def broken(store):
        raise RuntimeError("no settings")

    assert auto_start.process(db, application_id, deps_factory=broken) is None
    assert application(db, application_id)["aiRunStatus"] == "failed"
    [run] = runs_for(db, application_id)
    assert run["failedStep"] == "run" and "no settings" in run["failureReason"]


def test_a_finished_run_does_not_move_an_application_that_has_moved_on(db):
    application_id = applied(db)
    run_id = "run-1"
    auto_start.claim(db, application_id, run_id=run_id)
    db.collection("applications").document(application_id).update({"status": "Declined"})
    record = {"run_id": run_id, "application_id": application_id, "status": "complete", "finished_at": datetime.now(auto_start.UTC).isoformat(), "failed_step": None, "failure_reason": None}
    auto_start.finish(db, record)
    assert application(db, application_id)["status"] == "Declined" and "statusHistory" not in application(db, application_id)
    assert runs_for(db, application_id)[0]["status"] == "complete"


def test_a_run_that_was_replaced_cannot_touch_the_application(db):
    application_id = applied(db)
    auto_start.claim(db, application_id, run_id="run-1")
    db.collection("applications").document(application_id).update({"aiRunId": "run-2"})  # another run holds it now
    record = {"run_id": "run-1", "application_id": application_id, "status": "complete", "finished_at": datetime.now(auto_start.UTC).isoformat(), "failed_step": None, "failure_reason": None}
    auto_start.finish(db, record)
    stored = application(db, application_id)
    assert (stored["status"], stored["aiRunStatus"]) == ("Applied", "running")


# ---- re-run: the same claim, for a failed run --------------------------------------------------

def test_a_failed_run_can_be_re_run_and_the_new_run_points_back_at_it(db):
    application_id = applied(db)
    failed = auto_start.process(db, application_id, deps_factory=factory(tc.Providers(ollama=(500, b"boom"))))
    again = auto_start.rerun(db, application_id, failed["run_id"], deps_factory=factory())
    assert again["status"] == "complete" and again["rerun_of"] == failed["run_id"]
    assert application(db, application_id)["status"] == "AI Deliberated"
    runs = {run["id"]: run for run in runs_for(db, application_id)}
    assert runs[failed["run_id"]]["status"] == "failed"  # the failed record stays
    assert (runs[again["run_id"]]["trigger"], runs[again["run_id"]]["rerunOf"]) == ("rerun", failed["run_id"])


def test_only_a_failed_run_that_is_still_the_latest_can_be_re_run(db):
    application_id = applied(db)
    done = auto_start.process(db, application_id, deps_factory=factory())
    assert auto_start.rerun(db, application_id, done["run_id"], deps_factory=factory()) is None  # complete: it already moved on
    other = applied(db)
    failed = auto_start.process(db, other, deps_factory=factory(tc.Providers(ollama=(500, b"boom"))))
    assert auto_start.rerun(db, other, "some-other-run", deps_factory=factory()) is None
    assert auto_start.rerun(db, other, failed["run_id"], deps_factory=factory()) is not None


# ---- criterion 1 and 2 end to end: the listener -------------------------------------------------

def wait_for(check, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.2)
    return False


def test_the_listener_starts_a_run_when_an_application_becomes_applied_and_only_one(db):
    listener = auto_start.Listener(db, factory())
    listener.start()
    try:
        draft = applied(db, status="Draft")
        time.sleep(1)
        assert "aiRunStatus" not in application(db, draft)  # a Draft is not watched
        db.collection("applications").document(draft).update({"status": "Applied"})
        assert wait_for(lambda: application(db, draft).get("aiRunStatus") == "complete")
        assert application(db, draft)["status"] == "AI Deliberated"
        db.collection("applications").document(draft).update({"updatedAt": datetime.now(auto_start.UTC)})  # a second event for the same application
        time.sleep(2)
        assert len(runs_for(db, draft)) == 1
    finally:
        listener.stop()


def test_the_listener_picks_up_an_application_that_was_submitted_while_it_was_not_running(db):
    waiting = applied(db)
    listener = auto_start.Listener(db, factory())
    listener.start()
    try:
        assert wait_for(lambda: application(db, waiting).get("aiRunStatus") == "complete")
    finally:
        listener.stop()
