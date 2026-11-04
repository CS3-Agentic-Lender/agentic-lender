"""The retry and time limits every committee model call follows (AL-139 criterion 1).

A provider error that may clear is retried at most twice, after 2 s and then 8 s, or after the provider's Retry-After if that is
longer. A reply the check rejects gets one repair attempt. One call may take 60 s. The whole run has a 5 minute budget: when it
runs out the step stops asking, the run is saved as failed, and no recommendation is made.
"""

import time
from typing import Callable

INVALID_REPLY_RETRIES = 1
PROVIDER_RETRIES = 2
BACKOFF_S = (2.0, 8.0)
CALL_TIMEOUT_S = 60.0
RUN_BUDGET_S = 300.0


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


def pause_before_retry(retries_done: int, retry_after: float | None, budget: Budget | None) -> float | None:
    """Seconds to wait before the next try, or None when the budget cannot cover the wait and one more call."""
    pause = BACKOFF_S[retries_done]
    if retry_after is not None:
        pause = max(pause, retry_after)
    if budget is not None and pause >= budget.remaining():
        return None
    return pause
