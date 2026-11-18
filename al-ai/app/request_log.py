"""One log line per request, carrying its request id, so the id in a response or an error body finds its line in CloudWatch.

On ECS everything the container prints goes to CloudWatch. uvicorn only sets up its own loggers, so without send_to_stdout the
service's INFO lines (this one, and the call log lines from the agents) would be dropped. Only the method, the path (no query
string) and the status are logged, never headers or bodies, so no token or personal data reaches the logs.
"""

import json
import logging
import sys
import time

from fastapi import Request

log = logging.getLogger("al-ai.requests")


def send_to_stdout() -> None:
    """Print every al-ai.* logger at INFO and above. Safe to call twice: the handler is only added once."""
    parent = logging.getLogger("al-ai")
    if not parent.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
        parent.addHandler(handler)
        parent.setLevel(logging.INFO)


def record(request: Request, status: int, started: float, failed: bool = False) -> None:
    entry = {
        "call": "request", "request_id": request.state.request_id, "method": request.method, "path": request.url.path,
        "status": status, "duration_ms": round((time.perf_counter() - started) * 1000),
    }
    if failed:
        log.exception(json.dumps(entry))  # called from an except block, so the stack trace sits under the id
    else:
        log.info(json.dumps(entry))
