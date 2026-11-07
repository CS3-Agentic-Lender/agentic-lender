"""Every AI call behind a decision, saved as one `ai_calls` document (AL-140), so the demo can prove each call was really made.

One document for each model attempt (a retry is its own document), each Serper search, the valuation model's call, and a reused Market
& Macro report (which links to the call that made it instead of pretending a new one ran). The document id is
`{run_id}-{step}-{attempt}`, the same id the committee's run record lists under `ai_calls`, so the two line up.

The audit hash covers the stored document, so a document is only ever created, never overwritten (`Sink.create` refuses an id that
exists). A call is saved right after it ends, before the next one starts, so a crash keeps what happened. If a save fails twice the
step fails: no decision should rest on a call we cannot show. A document holds the prompt and the replies, never a key or a header:
only the fields below are copied from an attempt, and provider errors are already scrubbed of keys by the clients.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Protocol

COLLECTION = "ai_calls"
WRITE_ATTEMPTS = 2  # a save is tried twice, then the step fails

# The committee names its steps in the run record; the documents call the second one `valuation`, like the agents map on `ai_runs`.
AGENT_OF_STEP = {"market": "market", "affordability": "affordability", "valuation_agent": "valuation", "strategist": "strategist"}


class CallLogError(Exception):
    """A call could not be saved. The message never contains a key."""


class AlreadyStored(Exception):
    """The sink already holds a document with this id."""


class Sink(Protocol):
    def create(self, doc_id: str, doc: dict) -> None: ...
    def get(self, doc_id: str) -> dict | None: ...


class FirestoreSink:
    """ai_calls/{id}, written with `create`, which refuses an id that exists, so a stored call is never replaced."""

    def __init__(self, db):
        self.db = db

    def create(self, doc_id: str, doc: dict) -> None:
        from google.api_core.exceptions import AlreadyExists

        try:
            self.db.collection(COLLECTION).document(doc_id).create(doc)
        except AlreadyExists:
            raise AlreadyStored(doc_id) from None

    def get(self, doc_id: str) -> dict | None:
        snapshot = self.db.collection(COLLECTION).document(doc_id).get()
        return snapshot.to_dict() if snapshot.exists else None


def call_id(run_id: str, step: str, attempt: int | str) -> str:
    return f"{run_id}-{step}-{attempt}"


def _utc(value) -> datetime | None:
    if value is None:
        return None
    moment = value if isinstance(value, datetime) else datetime.fromisoformat(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _ids(source: dict) -> dict:
    missing = [key for key in ("run_id", "application_id", "broker_id") if not source.get(key)]
    if missing:
        raise CallLogError(f"the call has no {', '.join(missing)}, so it cannot be logged against a run and a broker")
    return {"runId": source["run_id"], "applicationId": source["application_id"], "brokerId": source["broker_id"]}


def _output(parsed) -> str | None:
    """What the underwriter reads: the agent's reply as text, in a fixed key order."""
    return None if parsed is None else json.dumps(parsed, sort_keys=True, ensure_ascii=False)


def _timing(started_at, duration_s: float | None, now: datetime) -> dict:
    started = _utc(started_at) or now
    ended = started + timedelta(seconds=duration_s) if duration_s is not None else now
    return {"startedAt": started, "endedAt": ended, "createdAt": ended, "latencyMs": None if duration_s is None else round(duration_s * 1000)}


def model_document(step: str, attempt: dict, request: dict, *, now: datetime | None = None) -> tuple[str, dict]:
    """The document for one model attempt of a committee step. `request` is what was sent: the system text and the prompt."""
    now = now or datetime.now(UTC)
    doc = {
        **_ids(attempt),
        "agent": AGENT_OF_STEP[step], "provider": attempt["provider"], "model": attempt["model"],
        "attempt": attempt["attempt"], "promptVersion": attempt["prompt_version"],
        **_timing(attempt.get("started_at"), attempt.get("duration_s"), now),
        "request": request, "rawReply": attempt.get("raw_reply"), "parsedReply": attempt.get("parsed_reply"),
        "output": _output(attempt.get("parsed_reply")), "requestId": attempt.get("request_id"),
        "inputTokens": attempt.get("input_tokens"), "outputTokens": attempt.get("output_tokens"),
        "outcome": attempt["outcome"], "error": attempt.get("error"), "reusedFrom": None,
    }
    return call_id(attempt["run_id"], step, attempt["attempt"]), doc


def search_document(step: str, number: int, entry: dict, *, now: datetime | None = None) -> tuple[str, dict]:
    """The document for one Serper search. `number` counts the run's searches from 1. The key is never part of `entry`."""
    now = now or datetime.now(UTC)
    request = {key: entry[key] for key in ("search", "num", "country", "period") if key in entry}
    doc = {
        **_ids(entry),
        "agent": AGENT_OF_STEP[step], "provider": "serper", "model": "google-search",
        "attempt": number, "promptVersion": entry.get("prompt_version"),
        **_timing(entry.get("started_at"), entry.get("duration_s"), now),
        "request": request, "rawReply": None, "parsedReply": entry.get("hits"), "output": _output(entry.get("hits")),
        "requestId": None, "inputTokens": None, "outputTokens": None,
        "outcome": entry["outcome"], "error": entry.get("error"), "reusedFrom": None,
    }
    return call_id(entry["run_id"], f"{step}-search", number), doc


def valuation_model_document(ids: dict, request: dict, *, model_version: str | None, output: dict | None, error: str | None, duration_s: float, now: datetime | None = None) -> tuple[str, dict]:
    """The document for the valuation model's call: its inputs, its answer or why it failed."""
    now = now or datetime.now(UTC)
    doc = {
        **_ids(ids),
        "agent": "valuation_model", "provider": "al-ai", "model": model_version or "valuation-model",
        "attempt": 1, "promptVersion": None,
        **_timing(None, duration_s, now),
        "request": request, "rawReply": None, "parsedReply": output, "output": _output(output),
        "requestId": None, "inputTokens": None, "outputTokens": None,
        "outcome": "ok" if error is None else "error", "error": error, "reusedFrom": None,
    }
    return call_id(ids["run_id"], "valuation_model", 1), doc


def reused_document(ids: dict, report: dict, *, now: datetime | None = None) -> tuple[str, dict]:
    """A day's Market & Macro report used again: no model and no search ran, so this links to the call that made the report."""
    now = now or datetime.now(UTC)
    doc = {
        **_ids(ids),
        "agent": "market", "provider": report.get("provider"), "model": report.get("model"),
        "attempt": None, "promptVersion": report.get("prompt_version"),
        **_timing(None, None, now),
        "request": None, "rawReply": None, "parsedReply": None, "output": None,
        "requestId": None, "inputTokens": None, "outputTokens": None,
        "outcome": "reused", "error": None, "reusedFrom": report.get("call_id"),
    }
    return call_id(ids["run_id"], "market", "reused"), doc


def save(sink: Sink, doc_id: str, doc: dict) -> None:
    """Create the document, trying twice. Raises CallLogError if it cannot be saved. Saving the same document again is not an error."""
    for _ in range(WRITE_ATTEMPTS):
        try:
            sink.create(doc_id, doc)
            return
        except AlreadyStored:
            if sink.get(doc_id) == doc:  # an earlier try did reach the store, only its answer was lost
                return
            raise CallLogError(f"a different call is already saved as {doc_id}") from None
        except Exception as exc:  # the store is down or refused: try once more
            failure = type(exc).__name__
    raise CallLogError(f"the call {doc_id} could not be saved ({failure})")


class CallRecorder:
    """What one committee step calls after each of its calls ends. One recorder for each step of each run."""

    def __init__(self, sink: Sink, step: str):
        self.sink, self.step, self.searches = sink, step, 0

    def __call__(self, attempt: dict, request: dict) -> None:
        save(self.sink, *model_document(self.step, attempt, request))

    def search(self, entry: dict) -> None:
        self.searches += 1
        save(self.sink, *search_document(self.step, self.searches, entry))

    def reused(self, ids: dict, report: dict) -> None:
        save(self.sink, *reused_document(ids, report))


def recorder(sink: Sink | None, step: str) -> CallRecorder | None:
    """The recorder for a step, or None when the run is not logging calls (the local runner and most tests)."""
    return CallRecorder(sink, step) if sink is not None else None
