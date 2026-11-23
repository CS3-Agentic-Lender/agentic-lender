"""One JSON line per committee transition, so a run on AWS can be followed in CloudWatch: the claim, each step's start and end,
and the run's finish.

Set up like request_log: only this logger gets a stdout handler at start-up. Every line has the same keys, null when they do not
apply. Only opaque ids (the run and the application), step names, the provider and model, the number of attempts and times are
written: never the application, its figures, the borrower's uid or a model reply. A step's failure reason can quote the borrower's
figures (a rejected reply, a validation message, a provider error), so a failure is logged as the exception's class name only.
The market step is the exception: its inputs are the public rates and web searches, so its reason text is written too.
Writing a line never fails a run: any error here is swallowed.
"""

import functools
import json
import logging
import sys
from datetime import datetime

log = logging.getLogger("al-ai.committee-runs")

SAFE_REASON_STEPS = {"market"}  # steps whose failure reason holds no borrower data
OUT_OF_TIME = "OutOfTime"  # the "class name" of a step stopped by the run's time budget


def send_to_stdout() -> None:
    """Print this logger's lines to stdout, one JSON object per line. Safe to call twice: the handler is only added once."""
    if not log.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        log.propagate = False


def _never_raises(write):
    @functools.wraps(write)
    def guarded(*args, **kwargs):
        try:
            write(*args, **kwargs)
        except Exception:
            pass

    return guarded


def _line(event: str, run_id: str, application_id: str, rerun_of: str | None, status: str, step: str | None = None,
          provider: str | None = None, model: str | None = None, attempt: int | None = None,
          duration_ms: int | None = None, reason: str | None = None) -> None:
    log.info(json.dumps({
        "call": "committee", "event": event, "run_id": run_id, "application_id": application_id, "rerun_of": rerun_of,
        "step": step, "status": status, "provider": provider, "model": model, "attempt": attempt, "duration_ms": duration_ms,
        "reason": reason,
    }))


def _reason(step: str, kind: str, text: str | None) -> str:
    return f"{kind}: {text}"[:300] if step in SAFE_REASON_STEPS and text else kind


@_never_raises
def claimed(run_id: str, application_id: str, rerun_of: str | None) -> None:
    _line("claimed", run_id, application_id, rerun_of, "started")


@_never_raises
def step_started(state: dict, step: str, agent) -> None:
    """`agent` is the step's configured config.AgentModel, None for a step that calls no model."""
    _line("step", state["run_id"], state["application_id"], state.get("rerun_of"), "started", step,
          agent.provider if agent else None, agent.model if agent else None)


@_never_raises
def step_ended(state: dict, step: str, result: dict, duration_s: float) -> None:
    """`result` is the step's update to the run state; a failed step's update holds its failure and the class name of what failed it."""
    done = result["steps"][step]
    kind = result["failures"][0]["kind"] if result.get("failures") else None
    attempts = done.get("attempts") or []
    last = attempts[-1] if attempts else {}
    _line(
        "step", state["run_id"], state["application_id"], state.get("rerun_of"), "failed" if kind else "ok", step,
        done.get("provider") or last.get("provider"), done.get("model") or last.get("model"), len(attempts) or None,
        round(duration_s * 1000), _reason(step, kind, done.get("error")) if kind else None,
    )


@_never_raises
def finished(record: dict, kind: str | None) -> None:
    """`record` is the run record; `kind` the class name of what failed its failed step."""
    started, ended = record.get("started_at"), record.get("finished_at")
    duration = round((datetime.fromisoformat(ended) - datetime.fromisoformat(started)).total_seconds() * 1000) if started and ended else None
    step = record.get("failed_step")
    _line(
        "finished", record["run_id"], record["application_id"], record.get("rerun_of"), record["status"], step,
        duration_ms=duration, reason=_reason(step, kind or "StepFailed", record.get("failure_reason")) if step else None,
    )
