"""Shared test set-up for al-ai.

Thread caps (AL-302): numpy, scikit-learn and joblib each start one thread per core, and with many small tests those threads
fight over the cores, so an uncapped run takes every core and is slower. Pytest loads this file before any test module, so
the caps are in place before those libraries are imported. A value already set wins, so `OMP_NUM_THREADS=8 uv run pytest`
still works. Tests only: the app and the training scripts are not capped.
"""

import os
from collections.abc import MutableMapping

TEST_THREADS = 2
THREAD_VARIABLES = ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "LOKY_MAX_CPU_COUNT")


def cap_threads(environ: MutableMapping[str, str]) -> None:
    """Fill in each thread variable that is not already set."""
    for name in THREAD_VARIABLES:
        environ.setdefault(name, str(TEST_THREADS))


cap_threads(os.environ)
