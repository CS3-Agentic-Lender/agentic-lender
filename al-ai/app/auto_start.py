"""Starts the committee by itself when an application becomes Applied (AL-141).

A Firestore listener in this service watches `applications` where `status == "Applied"`. For each one it claims the application
in a transaction (so two listeners, or two events for the same application, start one run) and runs the committee in a
background thread. The design is the one Dumi agreed on the ticket:

  claim    `aiRunStatus = "running"` and `aiRunId = <run id>` on the application, and the `ai_runs/{runId}` document, in one transaction.
           Only an application with no `aiRunStatus` is claimed: a `failed` one is not started again by the listener (that would loop
           for ever on an outage), it is re-run on purpose with `rerun`.
  finish   a complete run sets `aiRunStatus = "complete"`, moves `status` to `AI Deliberated` and appends the `statusHistory` entry in
           the same write. A failed run sets `aiRunStatus = "failed"`, leaves `status` at `Applied` and adds no entry.
  reason   the failure reason is on the `ai_runs` document, never on the application: the borrower can read their application.

The listener writes only the base `ai_runs` fields (applicationId, brokerId, status, trigger, startedAt, finishedAt) plus rerunOf,
failedStep and failureReason. The agents, the credit memo and the consensus are added by AL-62.

    cd al-ai && FIRESTORE_EMULATOR_HOST=localhost:8080 uv run python -m app.auto_start
"""

import logging
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Callable

from google.cloud import firestore
from google.cloud.firestore import SERVER_TIMESTAMP, ArrayUnion
from google.cloud.firestore_v1.base_query import FieldFilter

from app import approval_likelihood, committee, official_rates

log = logging.getLogger("al-ai.auto-start")

APPLICATIONS, AI_RUNS = "applications", "ai_runs"
APPLIED, AI_DELIBERATED = "Applied", "AI Deliberated"
TRANSACTION_ATTEMPTS = 10  # the client retries a transaction that lost a fight over the document (the default is 5, which four claims at once can use up)
WORKERS = 2  # committee runs at once in one service: each makes several provider calls, so a small number keeps us inside their rate limits

DepsFactory = Callable[[committee.RunStore], committee.Deps]
ExtraFields = Callable[[dict], dict]  # the application as the claim read it -> more fields to write with the claim


def claim(db, application_id: str, *, run_id: str, rerun_of: str | None = None, extra_fields: ExtraFields | None = None, now: datetime | None = None) -> dict | None:
    """Take the application for one run. Returns the application document, or None when someone else already has it (or it is not Applied).

    A first run needs an application that has never had an AI run. A re-run (`rerun_of`) needs one whose last run is that failed run.
    `extra_fields` works out more fields from the application as this transaction read it, and they are written in the same
    transaction: the place the approval likelihood fields go (AL-63). It runs inside the transaction function, which Firestore
    may run again on a retry, including attempts that then lose: so it must be a pure calculation with no other side effects.
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
        if rerun_of is not None and (data.get("aiRunStatus") != "failed" or data.get("aiRunId") != rerun_of):
            return None
        transaction.update(application, {"aiRunStatus": "running", "aiRunId": run_id, "updatedAt": SERVER_TIMESTAMP, **(extra_fields(data) if extra_fields else {})})
        transaction.set(run, {
            "applicationId": application_id, "brokerId": data.get("brokerId"), "status": "running",
            "trigger": "rerun" if rerun_of else "submit", "rerunOf": rerun_of, "startedAt": started,
            "finishedAt": None, "failedStep": None, "failureReason": None,
        })
        return data

    return take(db.transaction(max_attempts=TRANSACTION_ATTEMPTS))


def finish(db, record: dict, *, now: datetime | None = None) -> None:
    """Write the end of a run: its `ai_runs` document, and the application's `aiRunStatus` (and, if it is complete, its status).

    The status only moves while the application is still Applied and this run is still the one that holds it, so a late write
    from a run that was replaced can never move an application that has moved on. A complete run also rewrites the borrower's
    figures with its valuation (AL-63), in the same write; a failed run leaves the figures from submit.
    """
    run_id, application_id = record["run_id"], record["application_id"]
    application = db.collection(APPLICATIONS).document(application_id)
    run = db.collection(AI_RUNS).document(run_id)
    finished = now or datetime.fromisoformat(record["finished_at"])
    recalculate = figures_on_finish(record)

    @firestore.transactional
    def write(transaction):
        data = application.get(transaction=transaction).to_dict() or {}
        transaction.update(run, {
            "status": record["status"], "finishedAt": finished,
            "failedStep": record["failed_step"], "failureReason": record["failure_reason"],
        })
        if data.get("aiRunId") != run_id:
            return
        update = {"aiRunStatus": record["status"], "updatedAt": SERVER_TIMESTAMP}
        if recalculate:
            update.update(recalculate(data))
        if record["status"] == "complete" and data.get("status") == APPLIED:
            entry = {"from": APPLIED, "to": AI_DELIBERATED, "actor": "committee", "actorId": "al-ai", "at": finished}  # a real datetime: Firestore refuses a server timestamp inside an array
            update.update({"status": AI_DELIBERATED, "statusHistory": ArrayUnion([entry])})
        transaction.update(application, update)

    write(db.transaction(max_attempts=TRANSACTION_ATTEMPTS))


class FirestoreRunStore:
    """The committee's RunStore for the service: saving a record is finishing the run in Firestore. AL-62 adds the agent output here."""

    def __init__(self, db):
        self.db = db

    def save(self, record: dict) -> None:
        finish(self.db, record)


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

    Uses the rate the run used, so the figures match its credit memo, and adds the valuation concern. A HELOC gets its label and
    combined LTV here. An error leaves the figures from submit and never stops the status moving.
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


def process(db, application_id: str, *, deps_factory: DepsFactory, rerun_of: str | None = None) -> dict | None:
    """Claim the application and run the committee for it. Returns the run record, or None if the claim was not won.

    The deps come first, because the figures written with the claim need the benchmark rate. The committee turns its own step
    failures into a failed record. This also turns a crash outside the steps (building the deps, or the save itself failing)
    into a failed run, so an application is not left `running` because of a bug.
    """
    run_id = str(uuid.uuid4())
    try:
        deps, deps_error = deps_factory(FirestoreRunStore(db)), None
    except Exception as exc:
        deps, deps_error = None, exc
    application = claim(db, application_id, run_id=run_id, rerun_of=rerun_of, extra_fields=figures_on_claim(deps))
    if application is None:
        return None
    try:
        if deps_error is not None:
            raise deps_error
        return committee.run_committee(application, deps=deps, application_id=application_id, run_id=run_id, rerun_of=rerun_of)
    except Exception as exc:
        log.exception("committee run %s for %s crashed", run_id, application_id)
        finish(db, _crashed(run_id, application_id, exc))
        return None


def rerun(db, application_id: str, failed_run_id: str, *, deps_factory: DepsFactory) -> dict | None:
    """Run the committee again for an application whose last run is `failed_run_id`. Nothing calls this yet: what triggers a re-run is not decided."""
    return process(db, application_id, deps_factory=deps_factory, rerun_of=failed_run_id)


class Listener:
    """Watches the Applied applications and starts a run for each one that has not had one. Existing ones are picked up on start."""

    def __init__(self, db, deps_factory: DepsFactory, *, workers: int = WORKERS):
        self.db, self.deps_factory = db, deps_factory
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="committee")
        self.watch = None

    def start(self) -> None:
        query = self.db.collection(APPLICATIONS).where(filter=FieldFilter("status", "==", APPLIED))
        self.watch = query.on_snapshot(self._on_snapshot)

    def stop(self) -> None:
        if self.watch:
            self.watch.unsubscribe()
        self.pool.shutdown(wait=False, cancel_futures=True)

    def _on_snapshot(self, docs, changes, read_time) -> None:
        for change in changes:
            if change.type.name not in ("ADDED", "MODIFIED"):
                continue
            if (change.document.to_dict() or {}).get("aiRunStatus") is not None:
                continue  # already taken: skips a transaction, the claim would refuse it anyway
            self.pool.submit(self._run, change.document.id)

    def _run(self, application_id: str) -> None:
        try:
            process(self.db, application_id, deps_factory=self.deps_factory)
        except Exception:  # the claim itself failed (Firestore down): the next change to the application tries again
            log.exception("could not start a committee run for %s", application_id)


def start_from_env() -> Listener:
    """A started listener on the real Firestore (or the emulator, when FIRESTORE_EMULATOR_HOST is set), with the real providers."""
    from app.llm import smoke

    env = smoke.load_env()
    db = firestore.Client(project=os.getenv("FIREBASE_PROJECT_ID", "demo-al"))
    listener = Listener(db, lambda store: committee.local_deps(store, env))
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
