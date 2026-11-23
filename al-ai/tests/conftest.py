"""Shared test set-up for al-ai.

Thread caps (AL-302): numpy, scikit-learn and joblib each start one thread per core, and with many small tests those threads
fight over the cores, so an uncapped run takes every core and is slower. Pytest loads this file before any test module, so
the caps are in place before those libraries are imported. A value already set wins, so `OMP_NUM_THREADS=8 uv run pytest`
still works. Tests only: the app and the training scripts are not capped.
"""

import logging
import os
from collections.abc import MutableMapping

import pytest

TEST_THREADS = 2
THREAD_VARIABLES = ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "LOKY_MAX_CPU_COUNT")


def cap_threads(environ: MutableMapping[str, str]) -> None:
    """Fill in each thread variable that is not already set."""
    for name in THREAD_VARIABLES:
        environ.setdefault(name, str(TEST_THREADS))


cap_threads(os.environ)


@pytest.fixture(autouse=True)
def undo_the_start_up_logging():
    """The app's start-up gives the al-ai.requests and al-ai.committee-runs loggers their own stdout handler (app/request_log.py,
    app/run_log.py). Undo that after each test, so a test that runs the start-up (`with TestClient(app)`) doesn't change the logging of the tests after it."""
    saved = [(logger, list(logger.handlers), logger.level, logger.propagate)
             for logger in (logging.getLogger("al-ai.requests"), logging.getLogger("al-ai.committee-runs"))]
    yield
    for logger, handlers, level, propagate in saved:
        logger.handlers[:] = handlers
        logger.setLevel(level)
        logger.propagate = propagate
