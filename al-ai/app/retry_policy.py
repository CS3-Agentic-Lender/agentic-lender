"""The retry and time limits every committee model call follows (AL-139 criterion 1).

A provider error that may clear is retried at most twice, after 2 s and then 8 s, or after the provider's Retry-After if that is
longer. An overloaded provider (HTTP 503 "high demand", 429 rate limit) is given longer: up to three retries after 10, 30 and
60 s, because a demand spike usually passes in a minute or two. No pause is taken that the run's budget cannot cover.

A reply the check rejects gets one repair attempt. One call may take 60 s. The whole run has a 5 minute budget: when it runs
out the step stops asking, the run is saved as failed, and no recommendation is made.

A run still marked running twice the budget after it started is stale (AL-327): the task running it stopped part-way (a
deploy replaced it, or it crashed), so nothing will ever finish it. A stale run can be re-run like a failed one.
"""

import time
from datetime import datetime
from typing import Callable

INVALID_REPLY_RETRIES = 1
PROVIDER_RETRIES = 2
BACKOFF_S = (2.0, 8.0)
OVERLOADED_STATUSES = {429, 503}  # the provider is busy, not broken: asking again shortly will not help, asking a bit later will
OVERLOADED_BACKOFF_S = (10.0, 30.0, 60.0)
CALL_TIMEOUT_S = 60.0
RUN_BUDGET_S = 300.0
STALE_AFTER_S = 2 * RUN_BUDGET_S  # 10 minutes: a live run has given up on its budget long before this


class Budget:
    """The time one run may use. Started when the run starts; every model call and pause is checked against it."""

    def __init__(self, total_s: float = RUN_BUDGET_S, clock: Callable[[], float] = time.monotonic):
        self.total_s, self.clock = total_s, clock
        self.started = clock()

    def remaining(self) -> float:
        return self.total_s - (self.clock() - self.started)

    def reason(self) -> str:
        return f"the run's time budget of {self.total_s:g} s ran out"


def call_timeout(budget: Budget | None) -> float:
    """60 s for a call, less when the budget has less left."""
    return CALL_TIMEOUT_S if budget is None else max(0.1, min(CALL_TIMEOUT_S, budget.remaining()))


def _backoff(status: int | None) -> tuple[float, ...]:
    return OVERLOADED_BACKOFF_S if status in OVERLOADED_STATUSES else BACKOFF_S


def retries_left(status: int | None, retries_done: int) -> bool:
    """True while a retryable provider error with this HTTP status (None: no answer at all) has tries left."""
    return retries_done < len(_backoff(status))


def pause_before_retry(retries_done: int, retry_after: float | None, budget: Budget | None, status: int | None = None) -> float | None:
    """Seconds to wait before the next try, or None when the budget cannot cover the wait and one more call."""
    pause = _backoff(status)[retries_done]
    if retry_after is not None:
        pause = max(pause, retry_after)
    if budget is not None and pause >= budget.remaining():
        return None
    return pause


def is_stale(started_at: datetime | None, now: datetime) -> bool:
    """True when a run that is still marked running started more than STALE_AFTER_S before `now`.

    A running run with no start time counts as stale: the claim writes the start with the running status, so a run without
    one was never started properly and nothing is going to finish it.
    """
    return started_at is None or (now - started_at).total_seconds() > STALE_AFTER_S
