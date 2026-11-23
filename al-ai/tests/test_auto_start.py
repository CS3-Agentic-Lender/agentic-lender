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
from datetime import datetime, timedelta

import pytest
from google.cloud.firestore_v1.base_query import FieldFilter

import test_committee as tc
from app import approval_likelihood, auto_start, committee, dti_review, rates, risk_tier, valuation_review
from app.valuation_endpoint import ValuationResponse

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


def factory(providers=None, get_rate=tc.get_rate):
    providers = providers or tc.Providers()

    def make(store):
        return committee.Deps(
            store=store, report_store=tc.a_report_for_today(), get_rate=get_rate, today=tc.TODAY,
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


# ---- AL-327: a run left running by a stopped task -----------------------------------------------

def left_running(db, minutes_ago: float, **changes) -> tuple[str, str]:
    """An application whose run was claimed `minutes_ago` and never finished (the task stopped part-way). Returns (application, run)."""
    application_id = applied(db, **changes)
    run_id = f"run-{uuid.uuid4().hex[:8]}"
    auto_start.claim(db, application_id, run_id=run_id, now=datetime.now(auto_start.UTC) - timedelta(minutes=minutes_ago))
    return application_id, run_id


def run_doc(db, run_id):
    return db.collection("ai_runs").document(run_id).get().to_dict()


def test_a_re_run_of_a_stale_run_is_accepted_and_the_stale_run_is_marked_interrupted(db):
    application_id, stale = left_running(db, 11)
    assert auto_start.claim(db, application_id, run_id="run-new", rerun_of=stale) is not None
    old = run_doc(db, stale)
    assert (old["status"], old["failureReason"]) == ("failed", "interrupted")
    assert isinstance(old["finishedAt"], datetime)
    new = run_doc(db, "run-new")
    assert (new["status"], new["trigger"], new["rerunOf"]) == ("running", "rerun", stale)
    assert (application(db, application_id)["aiRunStatus"], application(db, application_id)["aiRunId"]) == ("running", "run-new")


@pytest.mark.parametrize("late_status", ["complete", "failed"])
def test_a_late_finish_from_a_reclaimed_run_leaves_it_interrupted_and_the_application_with_the_new_run(db, late_status):
    application_id, stale = left_running(db, 11)
    auto_start.claim(db, application_id, run_id="run-new", rerun_of=stale)
    late = {
        "run_id": stale, "application_id": application_id, "status": late_status, "finished_at": datetime.now(auto_start.UTC).isoformat(),
        "failed_step": None if late_status == "complete" else "affordability", "failure_reason": None if late_status == "complete" else "boom",
    }
    auto_start.finish(db, late)
    old = run_doc(db, stale)
    assert (old["status"], old["failedStep"], old["failureReason"]) == ("failed", "run", "interrupted")
    stored = application(db, application_id)
    assert (stored["aiRunStatus"], stored["aiRunId"], stored["status"]) == ("running", "run-new", "Applied")


def test_a_re_run_of_a_run_still_inside_ten_minutes_is_refused_and_the_run_is_left_alone(db):
    application_id, fresh = left_running(db, 9)
    assert auto_start.claim(db, application_id, run_id="run-new", rerun_of=fresh) is None
    assert run_doc(db, fresh)["status"] == "running" and run_doc(db, "run-new") is None
    assert application(db, application_id)["aiRunId"] == fresh


def test_two_sweeps_at_the_same_moment_reclaim_a_stale_run_once(db):
    """Both sweeps pick the stale run, and both workers are held until each is at its claim, so the two claims really race."""
    application_id, stale = left_running(db, 11)
    at_claim, make = threading.Barrier(2, timeout=20), factory()

    def held(store):
        at_claim.wait()  # building the run is the last thing before the claim
        return make(store)

    listeners = [auto_start.Listener(db, held) for _ in range(2)]
    futures, errors = [], []

    def sweep(listener):
        try:
            futures.extend(listener.sweep())
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=sweep, args=(listener,)) for listener in listeners]
    try:
        [t.start() for t in threads]
        [t.join(30) for t in threads]
        assert errors == [] and len(futures) == 2
        results = [future.result(timeout=60) for future in futures]
        assert len([result for result in results if result is not None]) == 1
        runs = {run["id"]: run for run in runs_for(db, application_id)}
        assert len(runs) == 2
        assert (runs[stale]["status"], runs[stale]["failureReason"]) == ("failed", "interrupted")
        [new] = [run for run_id, run in runs.items() if run_id != stale]
        assert (new["rerunOf"], new["status"]) == (stale, "complete")
        assert application(db, application_id)["status"] == "AI Deliberated"
    finally:
        at_claim.abort()  # frees a worker still waiting if the other never came
        [listener.stop() for listener in listeners]


def test_a_run_that_goes_stale_after_the_listener_started_is_reclaimed_by_a_later_sweep(db):
    application_id, run_id = left_running(db, 1)
    ahead = timedelta(0)
    listener = auto_start.Listener(db, factory(), sweep_every_s=0.2, clock=lambda: datetime.now(auto_start.UTC) + ahead)
    listener.start()
    try:
        time.sleep(1)  # several sweeps pass while the run is fresh
        assert run_doc(db, run_id)["status"] == "running"
        ahead = timedelta(minutes=10)
        assert wait_for(lambda: application(db, application_id).get("aiRunStatus") == "complete")
        assert run_doc(db, run_id)["failureReason"] == "interrupted"
        assert run_doc(db, application(db, application_id)["aiRunId"])["rerunOf"] == run_id
    finally:
        listener.stop()


def test_a_sweep_leaves_a_run_still_inside_ten_minutes_alone(db):
    application_id, fresh = left_running(db, 9)
    listener = auto_start.Listener(db, factory())
    try:
        assert listener.sweep() == []
        assert run_doc(db, fresh)["status"] == "running" and len(runs_for(db, application_id)) == 1
    finally:
        listener.stop()


def test_a_sweep_judges_staleness_by_the_clock_it_was_given(db):
    application_id, run_id = left_running(db, 1)
    listener = auto_start.Listener(db, factory(), clock=lambda: datetime.now(auto_start.UTC) + timedelta(minutes=10))
    try:
        [future] = listener.sweep()
        assert future.result(timeout=60)["rerun_of"] == run_id
    finally:
        listener.stop()


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


def test_the_listener_reclaims_a_stale_run_on_its_own_when_it_starts(db):
    application_id, stale = left_running(db, 11)
    listener = auto_start.Listener(db, factory())
    listener.start()
    try:
        assert wait_for(lambda: application(db, application_id).get("aiRunStatus") == "complete")
        assert run_doc(db, stale)["failureReason"] == "interrupted"
        assert run_doc(db, application(db, application_id)["aiRunId"])["rerunOf"] == stale
    finally:
        listener.stop()


def test_once_stopping_the_listener_claims_nothing_more(db):
    """A run picked up just before the stop is building its providers when the stop comes: its claim must not happen."""
    building, release = threading.Event(), threading.Event()
    make = factory()

    def slow(store):
        building.set()
        release.wait(10)
        return make(store)

    picked_up = applied(db)
    listener = auto_start.Listener(db, slow)
    listener.start()
    assert building.wait(10)
    listener.stop()
    release.set()
    stale_id, stale_run = left_running(db, 11)
    submitted = applied(db)
    time.sleep(2)
    assert listener.sweep() == []
    assert "aiRunStatus" not in application(db, picked_up) and "aiRunStatus" not in application(db, submitted)
    assert run_doc(db, stale_run)["status"] == "running"


def test_a_stop_while_the_claim_fetches_the_benchmark_rate_still_claims_nothing(db):
    """The figures written with the claim fetch the benchmark rate, which can be slow: a stop that comes during that fetch wins."""
    fetching, release = threading.Event(), threading.Event()

    def slow_rate(name):
        fetching.set()
        release.wait(10)
        return tc.get_rate(name)

    application_id = applied(db)
    listener = auto_start.Listener(db, factory(get_rate=slow_rate))
    listener.start()
    try:
        assert fetching.wait(10)
        listener.stop()
    finally:
        release.set()
    time.sleep(2)
    assert "aiRunStatus" not in application(db, application_id) and runs_for(db, application_id) == []


# ---- AL-63: the borrower's indicative figures, written on submit before the committee runs ----------------

FIGURES = ("approvalLikelihood", "dtiPct", "purchaseLtvPct", "ltvPct")
FAILING = tc.Providers(ollama=(500, b"boom"))  # a failed run keeps the figures from submit, so these show the submit write on its own


def figures(document):
    return {key: document[key] for key in FIGURES if key in document}


def expected_on_submit(sample):
    return approval_likelihood.application_fields(sample, benchmark_rate_pct=tc.RATES["mortgage_ie"].pct)


def test_submit_writes_the_figures_with_the_claim_at_the_benchmark_rate(db):
    application_id = applied(db)
    auto_start.process(db, application_id, deps_factory=factory(FAILING))
    stored = figures(application(db, application_id))
    assert stored == expected_on_submit(tc.MORTGAGE)
    assert set(stored) == {"approvalLikelihood", "dtiPct", "purchaseLtvPct"}


@pytest.mark.parametrize("stale_ltv", [None, 0, 72.5])
def test_a_mortgage_claim_has_no_model_ltv_before_the_committee_runs(db, stale_ltv):
    application_id = applied(db, ltvPct=stale_ltv, estimatedValueEur=500_000)
    deps = factory()(auto_start.FirestoreRunStore(db))
    auto_start.claim(db, application_id, run_id="run-1", extra_fields=auto_start.figures_on_claim(deps))
    stored = application(db, application_id)
    assert stored["purchaseLtvPct"] == 80.0
    assert "ltvPct" not in stored


@pytest.mark.parametrize("status,has_valuation,expected_ltv", [
    ("complete", True, 94.7),
    ("complete", False, None),
    ("failed", True, None),
])
def test_a_mortgage_only_saves_model_ltv_from_a_complete_run_with_a_valuation(db, status, has_valuation, expected_ltv):
    application_id = applied(db)
    auto_start.claim(db, application_id, run_id="run-1")
    record = {
        "run_id": "run-1", "application_id": application_id, "status": status,
        "finished_at": "2026-11-10T12:00:00+00:00", "failed_step": None, "failure_reason": None,
        "steps": {
            "calculations": {"output": {"benchmark_rate_pct": 4.0, "valuation_facts": {"support_warnings": []}}},
        },
    }
    if has_valuation:
        record["steps"]["valuation_model"] = {"output": {"estimate_eur": 380_000}}
    auto_start.finish(db, record)
    stored = application(db, application_id)
    if expected_ltv is None:
        assert "ltvPct" not in stored
    else:
        assert stored["ltvPct"] == expected_ltv
        assert stored["purchaseLtvPct"] == 80.0


def test_the_figures_are_there_before_the_committee_runs(db, monkeypatch):
    application_id = applied(db)
    seen = {}
    real_run = committee.run_committee

    def watching(*args, **kwargs):
        seen.update(figures(application(db, application_id)))  # what is stored as the committee starts
        return real_run(*args, **kwargs)

    monkeypatch.setattr(committee, "run_committee", watching)
    auto_start.process(db, application_id, deps_factory=factory(FAILING))
    assert seen == expected_on_submit(tc.MORTGAGE)


def test_a_heloc_is_unknown_on_submit_but_its_dti_is_written(db):
    application_id = applied(db, **{key: None for key in tc.MORTGAGE if key not in tc.HELOC}, **tc.HELOC)
    auto_start.process(db, application_id, deps_factory=factory(FAILING))
    stored = figures(application(db, application_id))
    assert stored["approvalLikelihood"] == "Unknown" and "dtiPct" in stored
    assert "purchaseLtvPct" not in stored and "ltvPct" not in stored


def test_no_figures_are_written_when_the_benchmark_rate_is_not_available(db):
    def no_rate(name):
        raise rates.RateUnavailable("the ECB is down and the cached rate is too old")

    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory(get_rate=no_rate))
    stored = application(db, application_id)
    assert figures(stored) == {}
    assert record["status"] == "failed" and record["failed_step"] == "market"  # the run fails on the same missing rate and says why


def test_a_crash_building_the_run_still_claims_and_fails_it_with_no_figures(db):
    def broken(store):
        raise RuntimeError("no settings")

    application_id = applied(db)
    assert auto_start.process(db, application_id, deps_factory=broken) is None
    stored = application(db, application_id)
    assert stored["aiRunStatus"] == "failed" and figures(stored) == {}


# ---- AL-63 criterion 4: recalculated when a run completes, with that run's rate and valuation -----------------

def expected_after(sample, record):
    rate, findings = approval_likelihood.from_run(record)
    return approval_likelihood.application_fields(sample, benchmark_rate_pct=rate, valuation=findings)


def heloc_applied(db):
    return applied(db, **{key: None for key in tc.MORTGAGE if key not in tc.HELOC}, **tc.HELOC)


def stale_before_save(db, application_id):
    """A deps factory whose store marks the figures stale just before the run is saved, so a test sees the save rewrite them."""

    def make(store):
        real_save = store.save

        def save(record):
            db.collection("applications").document(application_id).update({"approvalLikelihood": "stale", "dtiPct": -1})
            real_save(record)

        store.save = save
        return factory()(store)

    return make


def test_a_complete_run_recalculates_the_figures_with_its_valuation(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=stale_before_save(db, application_id))
    stored = application(db, application_id)
    assert stored["status"] == "AI Deliberated"
    assert figures(stored) == expected_after(tc.MORTGAGE, record)


def test_a_complete_heloc_run_turns_unknown_into_a_label_and_writes_its_combined_ltv(db):
    application_id = heloc_applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete", record["failure_reason"]
    stored = figures(application(db, application_id))
    assert stored == expected_after(tc.HELOC, record)
    assert stored["approvalLikelihood"] != "Unknown" and "ltvPct" in stored and "purchaseLtvPct" not in stored


def test_a_re_run_that_completes_recalculates_the_figures(db):
    application_id = heloc_applied(db)
    failed = auto_start.process(db, application_id, deps_factory=factory(FAILING))
    assert figures(application(db, application_id))["approvalLikelihood"] == "Unknown"  # the failed run kept the submit figures
    again = auto_start.rerun(db, application_id, failed["run_id"], deps_factory=factory())
    assert figures(application(db, application_id)) == expected_after(tc.HELOC, again)


def test_a_run_that_was_replaced_does_not_write_figures(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    db.collection("applications").document(application_id).update({"aiRunId": "run-2", "approvalLikelihood": "Low"})
    auto_start.finish(db, record)  # the old run's save arriving late
    assert application(db, application_id)["approvalLikelihood"] == "Low"


def test_a_crash_working_out_the_figures_never_stops_the_status_moving(db, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("bug in the rule")

    monkeypatch.setattr(approval_likelihood, "application_fields", broken)
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    stored = application(db, application_id)
    assert record["status"] == "complete" and stored["status"] == "AI Deliberated"
    assert figures(stored) == {}


# ---- AL-62: the reasoning trail is on the ai_runs document ----------------------------------------

def test_a_complete_run_saves_every_agent_the_memo_the_recommendations_and_the_consensus(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    [run] = runs_for(db, application_id)
    assert set(run["agents"]) == {"affordability", "valuation", "strategist", "market"}
    for agent in run["agents"].values():
        assert set(agent) == {"provider", "model", "promptVersion", "report", "recommendation", "rating", "concerns", "conditions"}
    assert run["agents"]["market"]["recommendation"] is None and run["agents"]["strategist"]["rating"] is None
    assert run["creditMemo"] == record["steps"]["strategist"]["memo"]
    assert (run["originalRecommendation"], run["effectiveRecommendation"]) == ("Approve", "Approve")
    assert run["consensus"] == {
        "votes": {"affordability": "Conditionally Approve", "valuation": "Conditionally Approve", "strategist": "Approve"}, "disagreement": True,
    }
    assert run["policyGate"] == record["steps"]["policy_gate"]["output"] and run["brokerId"] == "broker-1"  # the rules check this copy for broker access


def test_a_failed_run_saves_the_agents_that_finished_and_nulls_for_the_rest(db):
    application_id = applied(db)
    auto_start.process(db, application_id, deps_factory=factory(tc.Providers(ollama=(500, b"boom"))))
    [run] = runs_for(db, application_id)
    assert "market" in run["agents"] and "affordability" not in run["agents"]
    assert (run["creditMemo"], run["originalRecommendation"], run["effectiveRecommendation"], run["consensus"]) == (None, None, None, None)


# ---- AL-305: the policy gate's result on review/underwriting and on the run record, in one write ------------------

def review(db, application_id):
    return db.collection("applications").document(application_id).collection("review").document("underwriting").get().to_dict()


def finished(run_id, application_id, gate):
    """A complete record as the committee saves it, holding only the policy gate step (all finish reads)."""
    return {
        "run_id": run_id, "application_id": application_id, "status": "complete", "finished_at": datetime.now(auto_start.UTC).isoformat(),
        "failed_step": None, "failure_reason": None, "steps": {"policy_gate": {"ok": True, "output": gate}},
    }


GATE_1 = {"original": "Approve", "effective": "Conditionally Approve", "conditions": ["Requires lender exception review (LTV_CAP)"], "breaches": ["LTV_CAP"], "changed": True}
GATE_2 = {"original": "Approve", "effective": "Approve", "conditions": [], "breaches": [], "changed": False}


@pytest.mark.parametrize("make", [applied, heloc_applied], ids=["mortgage", "heloc"])
def test_a_complete_run_saves_the_gate_result_on_the_review_document_and_the_run_record(db, make):
    application_id = make(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete", record["failure_reason"]
    gate = record["steps"]["policy_gate"]["output"]
    [run] = runs_for(db, application_id)
    stored = review(db, application_id)
    assert run["policyGate"] == gate and stored["policyGate"] == gate
    assert set(gate) == {"original", "effective", "conditions", "breaches", "changed"}
    assert (stored["applicationId"], stored["brokerId"]) == (application_id, "broker-1")  # copied for the security rules
    assert isinstance(stored["updatedAt"], datetime)


def test_a_failed_run_before_the_gate_saves_no_gate_result(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory(FAILING))
    assert record["status"] == "failed" and "policy_gate" not in record["steps"]
    [run] = runs_for(db, application_id)
    assert "policyGate" not in run
    assert "policyGate" not in (review(db, application_id) or {})  # the run got past valuation, so the document holds its valuationDetail


def test_a_crash_outside_the_steps_saves_no_gate_result(db):
    application_id = applied(db)

    def broken(store):
        raise RuntimeError("no settings")

    auto_start.process(db, application_id, deps_factory=broken)
    assert "policyGate" not in runs_for(db, application_id)[0] and review(db, application_id) is None


def test_the_gate_result_leaves_the_other_review_fields_as_they_are(db):
    application_id = applied(db)
    underwriting = db.collection("applications").document(application_id).collection("review").document("underwriting")
    underwriting.set({"riskTier": "B", "valuationDetail": {"estimatedValueEur": 400000}, "policyGate": {"original": "Decline", "stale": True}})
    auto_start.claim(db, application_id, run_id="run-1")
    auto_start.finish(db, finished("run-1", application_id, GATE_1))
    stored = review(db, application_id)
    assert stored["policyGate"] == GATE_1  # replaced whole: no key from the old map is left behind
    assert (stored["riskTier"], stored["valuationDetail"]) == ("B", {"estimatedValueEur": 400000})


def rerun_claimed(db, application_id, failed_run_id, run_id):
    """Put the application back where a failed run leaves it, then claim it for a re-run, as `rerun` does."""
    db.collection("applications").document(application_id).update({"status": "Applied", "aiRunStatus": "failed", "aiRunId": failed_run_id})
    assert auto_start.claim(db, application_id, run_id=run_id, rerun_of=failed_run_id) is not None


def test_a_re_run_replaces_the_review_copy_and_the_old_run_keeps_its_own(db):
    application_id = applied(db)
    auto_start.claim(db, application_id, run_id="run-1")
    auto_start.finish(db, finished("run-1", application_id, GATE_1))
    rerun_claimed(db, application_id, "run-1", "run-2")
    auto_start.finish(db, finished("run-2", application_id, GATE_2))
    runs = {run["id"]: run for run in runs_for(db, application_id)}
    assert review(db, application_id)["policyGate"] == GATE_2
    assert (runs["run-1"]["policyGate"], runs["run-2"]["policyGate"]) == (GATE_1, GATE_2)


def test_a_run_that_was_replaced_keeps_its_gate_result_on_its_record_but_not_on_the_review_document(db):
    application_id = applied(db)
    auto_start.claim(db, application_id, run_id="run-1")
    rerun_claimed(db, application_id, "run-1", "run-2")
    auto_start.finish(db, finished("run-2", application_id, GATE_2))
    auto_start.finish(db, finished("run-1", application_id, GATE_1))  # the old run's save arriving late
    assert review(db, application_id)["policyGate"] == GATE_2
    assert {run["id"]: run["policyGate"] for run in runs_for(db, application_id)} == {"run-1": GATE_1, "run-2": GATE_2}


def test_an_application_with_no_broker_saves_the_gate_on_the_run_record_but_not_on_the_review_document(db, caplog):
    application_id = applied(db, brokerId=None)
    auto_start.claim(db, application_id, run_id="run-1")
    with caplog.at_level("WARNING", logger="al-ai.auto-start"):
        auto_start.finish(db, finished("run-1", application_id, GATE_1))
    assert review(db, application_id) is None  # no document, so no brokerId None written over a good value
    assert runs_for(db, application_id)[0]["policyGate"] == GATE_1
    assert application(db, application_id)["status"] == "AI Deliberated"
    assert "no brokerId" in caplog.text


@pytest.mark.parametrize("steps", [{"policy_gate": None}, {"policy_gate": {"ok": False, "output": GATE_1}}, {"policy_gate": {"ok": True, "output": None}}, {"policy_gate": {"ok": True}}],
                         ids=["step-is-none", "gate-not-ok", "output-is-none", "no-output"])
def test_a_missing_or_failed_gate_step_saves_no_gate_result_and_the_run_still_finishes(db, steps):
    application_id = applied(db)
    auto_start.claim(db, application_id, run_id="run-1")
    auto_start.finish(db, {**finished("run-1", application_id, GATE_1), "steps": steps})
    assert "policyGate" not in runs_for(db, application_id)[0] and review(db, application_id) is None
    assert application(db, application_id)["status"] == "AI Deliberated"  # finish did not raise, so process() does not mark it failed


# ---- AL-301: the risk tier and LTV band are written when a run completes -------------------------

def underwriting(db, application_id):
    return db.collection("applications").document(application_id).collection("review").document("underwriting").get().to_dict()


def expected_risk(record):
    findings = risk_tier.findings_from_run(record)
    return risk_tier.ltv_band(risk_tier.ltv_ratio(findings)), risk_tier.risk_tier(findings)


def assert_risk_written(db, application_id, record):
    band, tier = expected_risk(record)
    stored = application(db, application_id)
    assert (stored["ltvBand"], stored["riskTier"]) == (band, tier)
    review = underwriting(db, application_id)
    assert review["riskTier"] == tier
    assert (review["applicationId"], review["brokerId"]) == (application_id, "broker-1")
    assert isinstance(review["updatedAt"], datetime)


def test_a_complete_run_writes_the_band_and_tier_to_the_application_and_the_underwriting_copy(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete", record["failure_reason"]
    assert_risk_written(db, application_id, record)


def test_a_complete_heloc_run_writes_its_band_and_tier(db):
    application_id = heloc_applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete", record["failure_reason"]
    assert_risk_written(db, application_id, record)


def test_a_re_run_that_completes_writes_the_band_and_tier(db):
    application_id = applied(db)
    failed = auto_start.process(db, application_id, deps_factory=factory(FAILING))
    again = auto_start.rerun(db, application_id, failed["run_id"], deps_factory=factory())
    assert again["status"] == "complete"
    assert_risk_written(db, application_id, again)


def test_the_underwriting_copy_keeps_the_fields_other_writers_put_there(db):
    application_id = applied(db)
    db.collection("applications").document(application_id).collection("review").document("underwriting").set({"note": "kept"})
    auto_start.process(db, application_id, deps_factory=factory())
    assert underwriting(db, application_id)["note"] == "kept"


def test_a_failed_run_writes_neither_the_band_nor_the_tier(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory(FAILING))
    assert record["status"] == "failed"
    stored = application(db, application_id)
    assert "ltvBand" not in stored and "riskTier" not in stored
    assert "riskTier" not in (underwriting(db, application_id) or {})  # the run got past valuation, so the document holds its valuationDetail


def test_a_run_that_was_replaced_does_not_overwrite_the_band_or_tier(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    reference = db.collection("applications").document(application_id)
    reference.update({"aiRunId": "run-2", "ltvBand": "over_90", "riskTier": "Z"})  # the newer run's answer
    reference.collection("review").document("underwriting").set({"riskTier": "Z"}, merge=True)
    auto_start.finish(db, record)  # the old run's save arriving late
    stored = application(db, application_id)
    assert (stored["ltvBand"], stored["riskTier"]) == ("over_90", "Z")
    assert underwriting(db, application_id)["riskTier"] == "Z"


def assert_no_risk_written(db, application_id):
    """Checks the fields, not whether the review document exists: another ticket's write may create that document."""
    stored = application(db, application_id)
    assert "ltvBand" not in stored and "riskTier" not in stored
    assert "riskTier" not in (underwriting(db, application_id) or {})


@pytest.mark.parametrize("broken_function", ["findings_from_run", "risk_writes"])
def test_a_crash_working_out_the_risk_never_stops_the_status_moving(db, monkeypatch, broken_function):
    def broken(*args, **kwargs):
        raise RuntimeError("bug in the rule")

    monkeypatch.setattr(risk_tier, broken_function, broken)
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete" and application(db, application_id)["status"] == "AI Deliberated"
    assert_no_risk_written(db, application_id)


def test_an_application_with_no_broker_writes_no_band_or_tier_and_the_status_still_moves(db, caplog):
    record = auto_start.process(db, applied(db), deps_factory=factory())  # a complete record; the committee itself refuses a no-broker application
    assert record["status"] == "complete", record["failure_reason"]
    application_id = applied(db, brokerId=None)
    auto_start.claim(db, application_id, run_id="run-1")
    with caplog.at_level("WARNING", logger="al-ai.auto-start"):
        auto_start.finish(db, {**record, "run_id": "run-1", "application_id": application_id})
    assert application(db, application_id)["status"] == "AI Deliberated"
    assert_no_risk_written(db, application_id)
    assert "no brokerId" in caplog.text


# ---- the valuation model's result is saved on review/underwriting as soon as the valuation step has it ------------------

def no_rate(name):
    raise rates.RateUnavailable("the ECB is down and the cached rate is too old")


def detail_of(record):
    """The valuationDetail map the run's valuation step should have saved (SCHEMA.md valuationDetail)."""
    return valuation_review.valuation_detail(ValuationResponse.model_validate(record["steps"]["valuation_model"]["output"]))


def test_a_complete_run_saves_the_valuation_detail_beside_the_gate_and_the_tier(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete", record["failure_reason"]
    stored = underwriting(db, application_id)
    assert stored["valuationDetail"] == detail_of(record)
    assert stored["valuationDetail"]["displayEstimateEur"] == record["steps"]["valuation_model"]["output"]["display_estimate_eur"]
    assert stored["policyGate"] == record["steps"]["policy_gate"]["output"]  # neither write clobbers the other
    assert stored["riskTier"] == expected_risk(record)[1]
    assert (stored["applicationId"], stored["brokerId"]) == (application_id, "broker-1")


def test_a_run_that_fails_after_the_valuation_step_still_saves_the_valuation_detail(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory(get_rate=no_rate))
    assert (record["status"], record["failed_step"]) == ("failed", "market")
    stored = underwriting(db, application_id)
    assert stored["valuationDetail"] == detail_of(record)
    assert "policyGate" not in stored and "riskTier" not in stored


def test_a_run_that_fails_before_the_valuation_step_saves_no_valuation_detail(db):
    application_id = applied(db, grossIncomeEur=-1)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["failed_step"] == "validate"
    assert underwriting(db, application_id) is None


def test_a_re_run_replaces_the_valuation_detail(db):
    application_id = applied(db)
    failed = auto_start.process(db, application_id, deps_factory=factory(get_rate=no_rate))
    first = underwriting(db, application_id)["valuationDetail"]
    bigger = {**copy.deepcopy(tc.MORTGAGE["property"]), "floorAreaSqm": 200}
    db.collection("applications").document(application_id).update({"property": bigger})
    again = auto_start.rerun(db, application_id, failed["run_id"], deps_factory=factory())
    assert again["status"] == "complete", again["failure_reason"]
    stored = underwriting(db, application_id)["valuationDetail"]
    assert stored == detail_of(again) and stored["estimatedValueEur"] != first["estimatedValueEur"]


def test_a_failure_saving_the_valuation_detail_never_fails_the_run(db, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise RuntimeError("firestore said no")

    monkeypatch.setattr(valuation_review, "write_valuation", broken)
    application_id = applied(db)
    with caplog.at_level("ERROR", logger="al-ai.committee"):
        record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete", record["failure_reason"]
    assert application(db, application_id)["status"] == "AI Deliberated"
    assert "valuationDetail" not in underwriting(db, application_id)
    assert "valuation detail" in caplog.text


# ---- the DTI breakdown is saved on review/underwriting as soon as the calculations step has the run's rate ---------------

def breakdown_of(application, rate_pct=4.0, rate_date="2026-09"):
    """The dtiBreakdown map for an application at a rate (SCHEMA.md dtiBreakdown); the test rate is tc.RATES' 4.00% from 2026-09."""
    return dti_review.dti_breakdown(
        loan_eur=application["loanAmountEur"], term_years=application["termYears"], gross_income_eur=application["grossIncomeEur"],
        take_home_monthly_eur=application["monthlyTakeHomeEur"], debts_monthly_eur=application["monthlyDebtsEur"],
        living_costs_monthly_eur=application["monthlyLivingCostsEur"], benchmark_rate_pct=rate_pct, rate_date=rate_date,
    )


FAILS_AT_STRATEGIST = tc.Providers(gemini=(500, b"boom"))  # the day's market report already exists, so Gemini is only the strategist


def test_a_complete_run_saves_the_dti_breakdown_beside_everything_else(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete", record["failure_reason"]
    stored = underwriting(db, application_id)
    assert stored["dtiBreakdown"] == breakdown_of(tc.MORTGAGE)
    assert stored["dtiBreakdown"]["benchmarkRatePct"] == record["steps"]["calculations"]["output"]["benchmark_rate_pct"]
    assert stored["dtiBreakdown"]["rateDate"] == record["steps"]["calculations"]["output"]["benchmark_rate_month"]
    assert stored["valuationDetail"] == detail_of(record)  # none of the writes clobbers another
    assert stored["policyGate"] == record["steps"]["policy_gate"]["output"]
    assert stored["riskTier"] == expected_risk(record)[1]
    assert (stored["applicationId"], stored["brokerId"]) == (application_id, "broker-1")


def test_the_stored_dti_matches_the_application_s_own_dti(db):
    application_id = applied(db)
    auto_start.process(db, application_id, deps_factory=factory())
    assert round(underwriting(db, application_id)["dtiBreakdown"]["dtiPct"], 1) == application(db, application_id)["dtiPct"]


def test_a_run_that_fails_after_the_calculations_still_saves_the_dti_breakdown(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory(FAILS_AT_STRATEGIST))
    assert (record["status"], record["failed_step"]) == ("failed", "strategist")
    stored = underwriting(db, application_id)
    assert stored["dtiBreakdown"] == breakdown_of(tc.MORTGAGE)
    assert stored["valuationDetail"] == detail_of(record)
    assert "policyGate" not in stored and "riskTier" not in stored


def test_a_run_that_fails_before_the_calculations_saves_no_dti_breakdown(db):
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory(get_rate=no_rate))
    assert (record["status"], record["failed_step"]) == ("failed", "market")
    assert "dtiBreakdown" not in underwriting(db, application_id)  # the valuation detail is there, the breakdown is not


def test_a_re_run_replaces_the_dti_breakdown(db):
    application_id = applied(db)
    failed = auto_start.process(db, application_id, deps_factory=factory(FAILS_AT_STRATEGIST))
    first = underwriting(db, application_id)["dtiBreakdown"]
    db.collection("applications").document(application_id).update({"loanAmountEur": 300_000})
    again = auto_start.rerun(db, application_id, failed["run_id"], deps_factory=factory())
    assert again["status"] == "complete", again["failure_reason"]
    stored = underwriting(db, application_id)["dtiBreakdown"]
    assert stored == breakdown_of({**tc.MORTGAGE, "loanAmountEur": 300_000})
    assert stored["newRepaymentMonthlyEur"] < first["newRepaymentMonthlyEur"]


def test_a_run_that_was_replaced_does_not_save_its_dti_breakdown(db):
    application_id = applied(db)
    claimed = auto_start.claim(db, application_id, run_id="run-old")
    db.collection("applications").document(application_id).update({"aiRunId": "run-new"})
    store = auto_start.FirestoreRunStore(db)
    store.save_dti_breakdown(application_id, "run-old", breakdown_of(claimed))
    assert "dtiBreakdown" not in (underwriting(db, application_id) or {})


def test_a_failure_saving_the_dti_breakdown_never_fails_the_run(db, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise RuntimeError("firestore said no")

    monkeypatch.setattr(dti_review, "write_dti_breakdown", broken)
    application_id = applied(db)
    with caplog.at_level("ERROR", logger="al-ai.committee"):
        record = auto_start.process(db, application_id, deps_factory=factory())
    assert record["status"] == "complete", record["failure_reason"]
    assert application(db, application_id)["status"] == "AI Deliberated"
    assert "dtiBreakdown" not in underwriting(db, application_id)
    assert "DTI breakdown" in caplog.text


# ---- a run that was replaced writes nothing on review/underwriting, even when the re-run claims the application mid-save ----

def save_from_old_run(db, application_id, record, writer):
    store = auto_start.FirestoreRunStore(db)
    if writer == "write_valuation":
        store.save_valuation(application_id, record["run_id"], ValuationResponse.model_validate(record["steps"]["valuation_model"]["output"]))
    else:
        store.save_dti_breakdown(application_id, record["run_id"], breakdown_of(tc.MORTGAGE))


def old_run_with_no_review(db):
    """An application whose run failed at the market step, with its review document removed so any later write shows up."""
    application_id = applied(db)
    record = auto_start.process(db, application_id, deps_factory=factory(get_rate=no_rate))
    db.collection("applications").document(application_id).collection("review").document("underwriting").delete()
    return application_id, record


def test_a_run_that_was_replaced_does_not_save_its_valuation_detail(db):
    application_id, record = old_run_with_no_review(db)
    db.collection("applications").document(application_id).update({"aiRunId": "run-new"})
    save_from_old_run(db, application_id, record, "write_valuation")
    assert underwriting(db, application_id) is None


@pytest.mark.parametrize("module, writer", [(valuation_review, "write_valuation"), (dti_review, "write_dti_breakdown")])
def test_a_re_run_that_claims_the_application_mid_save_keeps_its_own_review(db, monkeypatch, module, writer):
    """The re-run takes the application and saves its review after the old run has checked it still holds it, and before the
    old run's write lands. The re-run's review must be the one left: the old run either saved first or saved nothing."""
    application_id, record = old_run_with_no_review(db)
    reference = db.collection("applications").document(application_id)
    field = {"write_valuation": "valuationDetail", "write_dti_breakdown": "dtiBreakdown"}[writer]
    real = getattr(module, writer)
    re_run = threading.Thread(target=lambda: (
        reference.update({"aiRunId": "run-new"}),  # the re-run's claim
        reference.collection("review").document("underwriting").set({field: "the re-run's"}, merge=True),
    ))

    def claimed_in_between(*args, **kwargs):
        if not re_run.is_alive() and re_run.ident is None:
            re_run.start()
            re_run.join(timeout=1)  # returns as soon as the re-run is done, unless it is waiting for this save to let go
        return real(*args, **kwargs)

    monkeypatch.setattr(module, writer, claimed_in_between)
    save_from_old_run(db, application_id, record, writer)
    re_run.join(timeout=30)
    assert underwriting(db, application_id)[field] == "the re-run's"
