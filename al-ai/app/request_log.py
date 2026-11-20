"""One log line per request, carrying its request id, so the id in a response or an error body finds its line in CloudWatch.

On ECS everything the container prints goes to CloudWatch. uvicorn only sets up its own loggers, so send_to_stdout gives this
one logger its own handler at start-up. Only this logger: the other al-ai.* loggers stay as they were (WARNING and above), so
the agents' and endpoints' INFO lines, which hold user ids, submitted figures and provider replies, don't reach the logs.
Each line is just a JSON object: the request id, method, path (no query string), status, duration and, on a crash, the
exception's class name. Never headers, bodies or exception messages, so no token or personal data is written.
"""

import json
import logging
import sys
import time

from fastapi import Request

log = logging.getLogger("al-ai.requests")


def send_to_stdout() -> None:
    """Print this logger's lines to stdout, one JSON object per line. Safe to call twice: the handler is only added once."""
    if not log.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        log.propagate = False  # only this handler prints it, whatever else sets up the root logger


def record(request: Request, status: int, started: float, error: str | None = None) -> None:
    entry = {
        "call": "request", "request_id": request.state.request_id, "method": request.method, "path": request.url.path,
        "status": status, "duration_ms": round((time.perf_counter() - started) * 1000),
    }
    if error:
        entry["error"] = error  # the class name only; uvicorn prints the stack trace itself
    log.info(json.dumps(entry))
