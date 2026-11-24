"""Starts the committee by itself when an application becomes Applied (AL-141).

A Firestore listener in this service watches `applications` where `status == "Applied"`. For each one it claims the application
in a transaction (so two listeners, or two events for the same application, start one run) and runs the committee in a
background thread. The design is the one Dumi agreed on the ticket:

  claim    `aiRunStatus = "running"` and `aiRunId = <run id>` on the application, and the `ai_runs/{runId}` document, in one transaction.
           Only an application with no `aiRunStatus` is claimed: a `failed` one is not started again by the listener (that would loop
           for ever on an outage), it is re-run on purpose with `rerun`.
  stale    a run still `running` more than retry_policy.STALE_AFTER_S (10 minutes, twice the run budget) after its `startedAt`.
           The task running it stopped part-way (a deploy replaced it, or it crashed), so nothing will finish it. The listener
           sweeps for stale runs once at start and every SWEEP_EVERY_S, and a stale run can be re-run like a failed one. Either
           way the claim, in one transaction, reads the application and the run again, marks the stale run failed with
           failureReason `interrupted`, and starts the new run with rerunOf pointing at it, so two listeners start it only once.
  finish   a complete run sets `aiRunStatus = "complete"`, moves `status` to `AI Deliberated` and appends the `statusHistory` entry in
           the same write. A failed run sets `aiRunStatus = "failed"`, leaves `status` at `Applied` and adds no entry. A run whose
           `ai_runs` document has already ended (an `interrupted` one that finishes late) writes nothing.
  reason   the failure reason is on the `ai_runs` document, never on the application: the borrower can read their application.
           `interrupted` means the run was stale and was replaced (its failedStep is `run`).
  stop     when the service is told to stop, the listener stops watching and sweeping, and claims nothing more (a claim in its
           transaction is let finish; one still fetching its rate is refused). A run already going is not waited for: if it
           does not finish before the task stops, it becomes stale and is reclaimed.

The claim writes the base `ai_runs` fields (applicationId, brokerId, status, trigger, startedAt, finishedAt) plus rerunOf,
failedStep and failureReason. The finish adds the agents, the credit memo, the recommendations and the consensus (AL-62, see
reasoning_trail.py), and the policy gate's result (policyGate, AL-305).

    cd al-ai && FIRESTORE_EMULATOR_HOST=localhost:8080 uv run python -m app.auto_start
"""

import logging
import os
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Callable

from google.cloud import firestore
from google.cloud.firestore import DELETE_FIELD, SERVER_TIMESTAMP, ArrayUnion
from google.cloud.firestore_v1.base_query import FieldFilter

from app import approval_likelihood, call_log, committee, dti_review, official_rates, rates, reasoning_trail, retry_policy, risk_tier, run_log, valuation_review
from app import market_agent as ma
from app.valuation_endpoint import ValuationResponse

log = logging.getLogger("al-ai.auto-start")

APPLICATIONS, AI_RUNS = "applications", "ai_runs"
APPLIED, AI_DELIBERATED = "Applied", "AI Deliberated"
TRANSACTION_ATTEMPTS = 10  # the client retries a transaction that lost a fight over the document (the default is 5, which four claims at once can use up)
INTERRUPTED = "interrupted"  # the failureReason of a stale run: the task running it stopped part-way, so it never finished
SWEEP_EVERY_S = 60.0  # how often the listener looks for stale runs; a stale run waits at most this long past STALE_AFTER_S
WORKERS = 2  # committee runs at once in one service: each makes several provider calls, so a small number keeps us inside their rate limits

DepsFactory = Callable[[committee.RunStore], committee.Deps]
ExtraFields = Callable[[dict], dict]  # the application as the claim read it -> more fields to write with the claim


def claim(db, application_id: str, *, run_id: str, rerun_of: str | None = None, extra_fields: ExtraFields | None = None, now: datetime | None = None) -> dict | None:
    """Take the application for one run. Returns the application document, or None when someone else already has it (or it is not Applied).

    A first run needs an application that has never had an AI run. A re-run (`rerun_of`) needs one whose last run is that run,
    and that run failed or is stale; a stale run is marked failed (`interrupted`) in the same transaction. `now` is the new run's
    start, and the time staleness is judged by.
    `extra_fields` works out more fields from the application as this transaction read it, and they are written in the same
    transaction: the place the approval likelihood fields go (AL-63). It runs inside the transaction function, which Firestore
    may run again on a retry, including attempts that then lose: so it must be a pure calculation with no other side effects.
    Clear any old mortgage model LTV here because this run does not have its own valuation yet.
    """
    application = db.collection(APPLICATIONS).document(application_id)
    run = db.collection(AI_RUNS).document(run_id)
    started = now or datetime.now(UTC)

    @firestore.transactional
    def take(transaction):
        snapshot = application.get(transaction=transaction)
        data = snapshot.to_dict() if snapshot.exists else None
        if not data or data.get("status") != APPLIED:
            return None
        if rerun_of is None and data.get("aiRunStatus") is not None:
            return None
        stale = None
        if rerun_of is not None:
            if data.get("aiRunId") != rerun_of or data.get("aiRunStatus") not in ("failed", "running"):
                return None
            if data.get("aiRunStatus") == "running":
                stale = db.collection(AI_RUNS).document(rerun_of)
                held = stale.get(transaction=transaction)
                if not run_is_stale(held.to_dict() if held.exists else None, started):
                    return None  # the run that holds it may still finish: leave it alone
        update = {"aiRunStatus": "running", "aiRunId": run_id, "updatedAt": SERVER_TIMESTAMP, **(extra_fields(data) if extra_fields else {})}
        if data.get("loanType") == "mortgage" and "ltvPct" in data:
            update["ltvPct"] = DELETE_FIELD
        if stale is not None:
            transaction.set(stale, {"status": "failed", "finishedAt": started, "failedStep": "run", "failureReason": INTERRUPTED}, merge=True)
        transaction.update(application, update)
        transaction.set(run, {
            "applicationId": application_id, "brokerId": data.get("brokerId"), "status": "running",
            "trigger": "rerun" if rerun_of else "submit", "rerunOf": rerun_of, "startedAt": started,
            "finishedAt": None, "failedStep": None, "failureReason": None,
        })
        return data

    return take(db.transaction(max_attempts=TRANSACTION_ATTEMPTS))


def run_is_stale(run: dict | None, now: datetime) -> bool:
    """True when an `ai_runs` document is still running past retry_policy.STALE_AFTER_S. A missing document or start time counts as stale."""
    run = run or {}
    return run.get("status", "running") == "running" and retry_policy.is_stale(run.get("startedAt"), now)


def finish(db, record: dict, *, now: datetime | None = None) -> None:
    """Write the end of a run: its `ai_runs` document, and the application's `aiRunStatus` (and, if it is complete, its status).

    The status only moves while the application is still Applied and this run is still the one that holds it, so a late write
    from a run that was replaced can never move an application that has moved on. A complete run also rewrites the borrower's
    figures with its valuation (AL-63), and writes its LTV band and risk tier (on the application and on `review/underwriting`,
    AL-301), in the same transaction; a failed run leaves the figures from submit and writes no tier. The run document also
    gets the reasoning trail (AL-62): each agent's report and vote, the credit memo, the recommendations and the consensus.
    A run that reached the policy gate saves the gate's result on its `ai_runs` document and on `review/underwriting` (AL-305),
    in the same transaction; a replaced run saves it on its own `ai_runs` document only. A run whose `ai_runs` document is no
    longer `running` has already ended (most often a stale run marked `interrupted` when it was reclaimed, AL-327): nothing is
    written, so a late finish cannot undo that.
    """
    run_id, application_id = record["run_id"], record["application_id"]
    application = db.collection(APPLICATIONS).document(application_id)
    run = db.collection(AI_RUNS).document(run_id)
    finished = now or datetime.fromisoformat(record["finished_at"])
    recalculate = figures_on_finish(record)
    gate = policy_gate_of(record)
    risk = risk_on_finish(record)

    @firestore.transactional
    def write(transaction):
        data = application.get(transaction=transaction).to_dict() or {}
        held = run.get(transaction=transaction)
        if not held.exists or (held.to_dict() or {}).get("status") != "running":
            # already ended: a stale run that was reclaimed (`interrupted`), or a run finished twice. Its end stands as written.
            log.warning("run %s for %s has already ended, so its late %s finish is not saved", run_id, application_id, record["status"])
            return
        transaction.update(run, {
            "status": record["status"], "finishedAt": finished,
            "failedStep": record["failed_step"], "failureReason": record["failure_reason"],
            **reasoning_trail.fields(record),  # each agent's report and vote and the consensus (AL-62)
            **({"policyGate": gate} if gate is not None else {}),
        })
        if data.get("aiRunId") != run_id:
            return
        if gate is not None:
            save_policy_gate(transaction, application, application_id, data, gate)
        update = {"aiRunStatus": record["status"], "updatedAt": SERVER_TIMESTAMP}
        if recalculate:
            update.update(recalculate(data))
        if risk:
            update.update(risk(transaction, application, data))
        if record["status"] == "complete" and data.get("status") == APPLIED:
            entry = {"from": APPLIED, "to": AI_DELIBERATED, "actor": "committee", "actorId": "al-ai", "at": finished}  # a real datetime: Firestore refuses a server timestamp inside an array
            update.update({"status": AI_DELIBERATED, "statusHistory": ArrayUnion([entry])})
        transaction.update(application, update)

    write(db.transaction(max_attempts=TRANSACTION_ATTEMPTS))


# Everything the gate save owns on review/underwriting. `merge=` takes these field paths as a mask, the same as valuation_review:
# policyGate is replaced whole (no key from the last run's map is left behind) and no other field on the document is touched.
POLICY_GATE_REVIEW_FIELDS = ["applicationId", "brokerId", "updatedAt", "policyGate"]


def policy_gate_of(record: dict) -> dict | None:
    """The policy gate step's output exactly as the committee returned it, or None when there is no gate result to save.

    That is a run that stopped before the gate, a step stored as None, or a gate step that did not succeed (`ok` is not True):
    a failed gate's output is never saved as the result.
    """
    step = (record.get("steps") or {}).get("policy_gate") or {}
    return step.get("output") if step.get("ok") is True else None


def save_policy_gate(transaction, application, application_id: str, data: dict, gate: dict) -> None:
    """Write the gate's result on `applications/{id}/review/underwriting`, in the caller's transaction (al-core/SCHEMA.md `policyGate`).

    applicationId and brokerId are copied there for the security rules, the same as the valuation and risk tier writes. An
    application with no brokerId is skipped and logged, never written with brokerId None: that would overwrite a good value.
    """
    broker_id = data.get("brokerId")
    if not broker_id:
        log.warning("application %s has no brokerId, so its policy gate result is not saved on review/underwriting", application_id)
        return
    review = application.collection("review").document("underwriting")
    transaction.set(
        review,
        {"applicationId": application_id, "brokerId": broker_id, "updatedAt": SERVER_TIMESTAMP, "policyGate": gate},
        merge=POLICY_GATE_REVIEW_FIELDS,
    )


class FirestoreRunStore:
    """The committee's RunStore for the service: saving a record is finishing the run in Firestore, reasoning trail included."""

    def __init__(self, db):
        self.db = db

    def save(self, record: dict) -> None:
        finish(self.db, record)

    def save_valuation(self, application_id: str, run_id: str, response: ValuationResponse) -> None:
        """Save the valuation model's result on `review/underwriting` (valuation_review.write_valuation), called by the committee
        right after its valuation step, so the estimate is there even if a later step fails. Skipped when this run no longer
        holds the application (it was replaced), so a late run never overwrites the newer run's detail."""
        self._save_while_held(application_id, run_id, "valuation detail", lambda transaction: valuation_review.write_valuation(self.db, application_id, response, transaction=transaction))

    def save_dti_breakdown(self, application_id: str, run_id: str, breakdown: dict) -> None:
        """Save the run's DTI breakdown on `review/underwriting` (dti_review.write_dti_breakdown), called by the committee right
        after its calculations step, so the figures and the run's rate are there even if a later step fails. Skipped when this
        run no longer holds the application, as for the valuation detail."""
        self._save_while_held(application_id, run_id, "DTI breakdown", lambda transaction: dti_review.write_dti_breakdown(self.db, application_id, breakdown, transaction=transaction))

    def _save_while_held(self, application_id: str, run_id: str, what: str, write: Callable) -> None:
        """Run `write(transaction)` only while this run holds the application, checked in the same transaction as the write:
        a re-run that claims the application between the check and the write makes the transaction retry, and the retry sees
        the new aiRunId and writes nothing."""
        application = self.db.collection(APPLICATIONS).document(application_id)

        @firestore.transactional
        def save(transaction):
            if (application.get(transaction=transaction).to_dict() or {}).get("aiRunId") != run_id:
                log.warning("run %s no longer holds %s, so its %s is not saved", run_id, application_id, what)
                return
            write(transaction)

        save(self.db.transaction(max_attempts=TRANSACTION_ATTEMPTS))


def _crashed(run_id: str, application_id: str, exc: Exception) -> dict:
    return {
        "run_id": run_id, "application_id": application_id, "status": "failed", "finished_at": datetime.now(UTC).isoformat(),
        "failed_step": "run", "failure_reason": f"the run stopped unexpectedly: {type(exc).__name__}: {exc}"[:300],
    }


def figures_on_claim(deps: committee.Deps | None) -> ExtraFields | None:
    """The borrower's indicative figures to write with the claim (AL-63): LTV, DTI at the benchmark rate and the approval likelihood.

    No valuation exists yet, so a HELOC is Unknown here and gets its full figures when the run completes. If the benchmark rate
    cannot be had, nothing is written: a rate is never guessed, and the run then fails on the same missing rate and says why.
    Working the figures out never stops the claim: an error leaves them unwritten and the run goes ahead.
    """
    if deps is None:
        return None
    try:
        rate = deps.get_rate(official_rates.BENCHMARK).pct
    except Exception as exc:  # RateUnavailable, or the cache itself failing
        log.warning("no benchmark rate for the borrower's figures, so none are written: %s", exc)
        return None

    def fields(application: dict) -> dict:
        try:
            return approval_likelihood.application_fields(application, benchmark_rate_pct=rate)
        except Exception:
            log.exception("could not work out the borrower's figures on claim")
            return {}

    return fields


def figures_on_finish(record: dict) -> ExtraFields | None:
    """The borrower's figures recalculated from a complete run (AL-63 criterion 4), or None for a run that did not get that far.

    Uses the run's rate and valuation concern so the figures match its credit memo. A mortgage gets its LTV against the
    estimate, and a HELOC gets its label and combined LTV. An error leaves the figures from submit and never stops the status moving.
    """
    try:
        found = approval_likelihood.from_run(record)
    except Exception:
        log.exception("could not read the valuation from run %s, so the figures from submit stay", record.get("run_id"))
        return None
    if found is None:
        return None
    rate, valuation = found

    def fields(application: dict) -> dict:
        try:
            return approval_likelihood.application_fields(application, benchmark_rate_pct=rate, valuation=valuation)
        except Exception:
            log.exception("could not recalculate the borrower's figures for run %s", record.get("run_id"))
            return {}

    return fields


def risk_on_finish(record: dict):
    """The LTV band and risk tier from a complete run (AL-301), or None for a run that did not get as far as the calculations.

    The returned function runs inside finish's transaction, after the check that this run still holds the application: it stages
    the `review/underwriting` write on the transaction and returns the application's fields, so both documents change in the
    same commit as the status, or not at all. Like the figures, an error (or an application with no brokerId) writes no tier
    and never stops the status moving.
    """
    try:
        findings = risk_tier.findings_from_run(record)
    except Exception:
        log.exception("could not read the risk findings from run %s, so no tier is written", record.get("run_id"))
        return None
    if findings is None:
        return None

    def write(transaction, application, data: dict) -> dict:
        broker_id = data.get("brokerId")
        if not broker_id:
            log.warning("application %s has no brokerId, so no tier is written for run %s", application.id, record.get("run_id"))
            return {}
        try:
            on_application, on_underwriting = risk_tier.risk_writes(application.id, broker_id, findings)
        except Exception:
            log.exception("could not work out the risk tier for run %s", record.get("run_id"))
            return {}
        transaction.set(risk_tier.underwriting_document(application), on_underwriting, merge=True)
        return on_application

    return write


class StopGate:
    """Lets claims through until the service stops (AL-327). A claim holds the gate's lock for its whole transaction, and `close`
    takes the same lock, so once `close` returns no claim is in progress and none can start: a claim then gets None."""

    def __init__(self):
        self.lock, self.closed = threading.Lock(), False

    def close(self) -> None:
        with self.lock:
            self.closed = True

    def claim(self, take: Callable[[], dict | None]) -> dict | None:
        with self.lock:
            return None if self.closed else take()


@dataclass(frozen=True)
class ClaimedRun:
    """A run whose claim was won: what `run_claimed` needs to run the committee for it."""

    run_id: str
    application_id: str
    rerun_of: str | None
    application: dict  # the application as the claim read it
    deps: committee.Deps | None
    deps_error: Exception | None  # building the deps failed: the run is claimed anyway and then fails with this


def claim_run(
    db, application_id: str, *, deps_factory: DepsFactory, rerun_of: str | None = None,
    now: datetime | None = None, gate: StopGate | None = None,
) -> ClaimedRun | None:
    """Build the run's deps and claim the application for it. Returns the claimed run, or None if the claim was not won.

    The deps come first, because the figures written with the claim need the benchmark rate. A crash building them does not
    stop the claim: the run is claimed and then fails (run_claimed), so the failure is recorded. With a `gate`, the claim goes
    through it after the figures are worked out (fetching the rate can be slow): once the gate is closed the application is
    not claimed (the service is shutting down, AL-327), and None is returned.
    """
    run_id = str(uuid.uuid4())
    try:
        deps, deps_error = deps_factory(FirestoreRunStore(db)), None
    except Exception as exc:
        deps, deps_error = None, exc
    extra_fields = figures_on_claim(deps)

    def take():
        return claim(db, application_id, run_id=run_id, rerun_of=rerun_of, extra_fields=extra_fields, now=now)

    application = gate.claim(take) if gate is not None else take()
    if application is None:
        return None
    run_log.claimed(run_id, application_id, rerun_of)
    return ClaimedRun(run_id, application_id, rerun_of, application, deps, deps_error)


def run_claimed(db, claimed: ClaimedRun) -> dict | None:
    """Run the committee for a claimed run. Returns the run record, or None if the run crashed outside its steps.

    The committee turns its own step failures into a failed record. This also turns a crash outside the steps (building the
    deps, or the save itself failing) into a failed run, so an application is not left `running` because of a bug.
    """
    run_id, application_id, rerun_of = claimed.run_id, claimed.application_id, claimed.rerun_of
    try:
        if claimed.deps_error is not None:
            raise claimed.deps_error
        return committee.run_committee(claimed.application, deps=claimed.deps, application_id=application_id, run_id=run_id, rerun_of=rerun_of)
    except Exception as exc:
        log.exception("committee run %s for %s crashed", run_id, application_id)
        crashed = _crashed(run_id, application_id, exc)
        run_log.finished({**crashed, "rerun_of": rerun_of}, type(exc).__name__)
        finish(db, crashed)
        return None


def process(
    db, application_id: str, *, deps_factory: DepsFactory, rerun_of: str | None = None,
    now: datetime | None = None, gate: StopGate | None = None,
) -> dict | None:
    """Claim the application and run the committee for it, in this thread (claim_run, then run_claimed). Returns the run
    record, or None if the claim was not won or the run crashed outside its steps."""
    claimed = claim_run(db, application_id, deps_factory=deps_factory, rerun_of=rerun_of, now=now, gate=gate)
    return None if claimed is None else run_claimed(db, claimed)


def rerun(db, application_id: str, failed_run_id: str, *, deps_factory: DepsFactory) -> dict | None:
    """Run the committee again, in this thread, for an application whose last run is `failed_run_id`, failed or stale.
    The service re-runs through Listener.rerun instead, which answers at once and runs in the background (POST /ai/committee/runs)."""
    return process(db, application_id, deps_factory=deps_factory, rerun_of=failed_run_id)


class Refusal(StrEnum):
    """Why a re-run was not started."""

    NOT_FOUND = "not_found"  # no such application
    RUNNING = "running"  # its run is still going and not stale (or another re-run has just started)
    NOTHING_TO_RERUN = "nothing_to_rerun"  # not Applied, never run, or its run is complete
    STOPPING = "stopping"  # the service is shutting down


@dataclass(frozen=True)
class RerunStarted:
    run_id: str


@dataclass(frozen=True)
class RerunRefused:
    reason: Refusal


def rerun_target(db, application_id: str, now: datetime) -> str | Refusal:
    """The run a re-run would replace (the application's aiRunId, when that run failed or is stale at `now`), or why there is none.

    Only a read, to pick the run and to say why a re-run is refused: the claim reads the application and the run again in its
    transaction, so what this read saw can never start a second run."""
    snapshot = db.collection(APPLICATIONS).document(application_id).get()
    if not snapshot.exists:
        return Refusal.NOT_FOUND
    data = snapshot.to_dict() or {}
    run_id, ai_run_status = data.get("aiRunId"), data.get("aiRunStatus")
    if data.get("status") != APPLIED or not run_id:
        return Refusal.NOTHING_TO_RERUN
    if ai_run_status == "failed":
        return run_id
    if ai_run_status == "running":
        held = db.collection(AI_RUNS).document(run_id).get()
        return run_id if run_is_stale(held.to_dict() if held.exists else None, now) else Refusal.RUNNING
    return Refusal.NOTHING_TO_RERUN


class Listener:
    """Watches the Applied applications and starts a run for each one that has not had one. Existing ones are picked up on start.

    It also sweeps for stale runs (AL-327) once at start and then every `sweep_every_s`: a run left running by a task that
    stopped part-way changes nothing in Firestore, so the watch never hears about it. `clock` gives the time a sweep and its
    claims judge staleness by. After `stop` begins, nothing new is claimed.
    """

    def __init__(self, db, deps_factory: DepsFactory, *, workers: int = WORKERS, sweep_every_s: float = SWEEP_EVERY_S, clock: Callable[[], datetime] = lambda: datetime.now(UTC)):
        self.db, self.deps_factory = db, deps_factory
        self.sweep_every_s, self.clock = sweep_every_s, clock
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="committee")
        self.watch = None
        self.stopping = threading.Event()  # wakes the sweep thread
        self.gate = StopGate()

    def start(self) -> None:
        query = self.db.collection(APPLICATIONS).where(filter=FieldFilter("status", "==", APPLIED))
        self.watch = query.on_snapshot(self._on_snapshot)
        threading.Thread(target=self._sweep_every, name="committee-sweep", daemon=True).start()

    def stop(self) -> None:
        """Stop taking applications: the watch and the sweep end first, and a claim not yet made is not made. A run already going
        is not waited for: if the task is stopped before it finishes, it is left running and a later sweep reclaims it as stale.
        A claim already in its transaction is waited for (it is short); once this returns, no claim can start."""
        self.gate.close()
        self.stopping.set()
        if self.watch:
            self.watch.unsubscribe()
        self.pool.shutdown(wait=False, cancel_futures=True)

    def sweep(self) -> list[Future]:
        """Start a new run for each Applied application whose run is stale. Returns the submitted runs, each resolving to its record or None.

        This read only picks the candidates: the claim reads the application and the run again in its transaction, so two
        sweeps (in one service or two) that both pick the same run start one new run between them.
        """
        if self.stopping.is_set():
            return []
        now = self.clock()
        query = (self.db.collection(APPLICATIONS)
                 .where(filter=FieldFilter("status", "==", APPLIED))
                 .where(filter=FieldFilter("aiRunStatus", "==", "running")))
        futures = []
        for doc in query.stream():
            run_id = (doc.to_dict() or {}).get("aiRunId")
            if not run_id:
                log.warning("application %s is running with no aiRunId, so it cannot be reclaimed", doc.id)
                continue
            run = self.db.collection(AI_RUNS).document(run_id).get()
            if run_is_stale(run.to_dict() if run.exists else None, now):
                log.info("run %s for %s is stale, starting a new one", run_id, doc.id)
                future = self._submit(doc.id, run_id)
                if future is not None:
                    futures.append(future)
        return futures

    def _sweep_every(self) -> None:
        while not self.stopping.is_set():
            try:
                self.sweep()
            except Exception:  # Firestore down: the next sweep tries again
                log.exception("the sweep for stale committee runs failed")
            self.stopping.wait(self.sweep_every_s)

    def _on_snapshot(self, docs, changes, read_time) -> None:
        for change in changes:
            if change.type.name not in ("ADDED", "MODIFIED"):
                continue
            if (change.document.to_dict() or {}).get("aiRunStatus") is not None:
                continue  # already taken: skips a transaction, the claim would refuse it anyway
            self._submit(change.document.id)

    def rerun(self, application_id: str) -> RerunStarted | RerunRefused:
        """Re-run the committee for an application whose run failed or is stale (POST /ai/committee/runs). The claim is made
        here, so the caller gets the new run id at once; the run itself goes on this listener's pool, like any other run.

        The claim is the same transaction as every other (rerun_of = the run it replaces), so two calls at once, or a call and
        a sweep, start one run between them: the call that loses is refused as RUNNING.
        """
        if self.stopping.is_set():
            return RerunRefused(Refusal.STOPPING)
        now = self.clock()
        target = rerun_target(self.db, application_id, now)
        if isinstance(target, Refusal):
            return RerunRefused(target)
        claimed = claim_run(self.db, application_id, deps_factory=self.deps_factory, rerun_of=target, now=now, gate=self.gate)
        if claimed is None:
            if self.stopping.is_set():
                return RerunRefused(Refusal.STOPPING)
            again = rerun_target(self.db, application_id, now)  # most often another call has just won the claim
            return RerunRefused(again if isinstance(again, Refusal) else Refusal.RUNNING)
        try:
            self.pool.submit(run_claimed, self.db, claimed)
        except RuntimeError:  # the service stopped just after the claim: the run stays running and a later sweep reclaims it as stale
            log.warning("run %s for %s was claimed as the service stopped, so a later sweep restarts it", claimed.run_id, application_id)
        return RerunStarted(claimed.run_id)

    def _submit(self, application_id: str, rerun_of: str | None = None) -> Future | None:
        if self.stopping.is_set():
            return None
        try:
            return self.pool.submit(self._run, application_id, rerun_of)
        except RuntimeError:  # the pool was shut down between the check and the submit
            return None

    def _run(self, application_id: str, rerun_of: str | None = None) -> dict | None:
        try:
            return process(self.db, application_id, deps_factory=self.deps_factory, rerun_of=rerun_of, now=self.clock(), gate=self.gate)
        except Exception:  # the claim itself failed (Firestore down): the next change, or the next sweep, tries again
            log.exception("could not start a committee run for %s", application_id)
            return None


def deps_factory_for(db, env: dict) -> DepsFactory:
    """What each run is built from: the real providers, and every AI call of the run saved in `ai_calls` on the same database (AL-140).

    The market report store is made here, once, so every run and re-run this listener starts shares it and reuses the day's report.
    It lives in memory: a restart empties it, so the first run after a restart makes a new report."""
    sink = call_log.FirestoreSink(db)
    reports = ma.MemoryReportStore()
    return lambda store: committee.local_deps(store, env, reports, call_sink=sink)


def warm_rates(get_rate: official_rates.GetRate) -> None:
    """Fetch every ECB series once so `rates_cache` is filled: a fresh deploy starts with it empty, and a cold ECB reply is slow."""
    for name in rates.SERIES:
        try:
            get_rate(name)
        except Exception as exc:  # the first run fetches it again; a failed warm-up must not stop the service
            log.warning("could not warm the %s rate: %s", name, exc)


def start_from_env() -> Listener:
    """A started listener on the real Firestore (or the emulator, when FIRESTORE_EMULATOR_HOST is set), with the real providers.
    The rates cache is warmed in the background, so a slow or unreachable ECB never holds up the start."""
    from app.llm import smoke

    env = smoke.load_env()
    db = firestore.Client(project=os.getenv("FIREBASE_PROJECT_ID", "demo-al"))
    threading.Thread(target=warm_rates, args=(committee.get_rate_waiting,), name="rates-warm", daemon=True).start()
    listener = Listener(db, deps_factory_for(db, env))
    listener.start()
    return listener


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    listener = start_from_env()
    log.info("watching for Applied applications")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        listener.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
