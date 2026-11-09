"""The test suite caps the threads numpy, scikit-learn and joblib use, so a full run does not take every core (AL-302)."""

import os

import joblib
import sklearn.ensemble  # noqa: F401  (loads the OpenMP pool the models train with)
import threadpoolctl

import conftest


def test_the_libraries_use_no_more_threads_than_the_cap():
    cap = int(os.environ["OMP_NUM_THREADS"])  # the cap, or what someone set on the command line instead
    pools = threadpoolctl.threadpool_info()
    assert pools, "no thread pool loaded, so this checks nothing"
    assert all(pool["num_threads"] <= cap for pool in pools), pools
    assert joblib.cpu_count() <= int(os.environ["LOKY_MAX_CPU_COUNT"])  # what n_jobs=-1 means


def test_every_variable_is_filled_in_when_it_is_not_set():
    env = {}
    conftest.cap_threads(env)
    assert env == {name: str(conftest.TEST_THREADS) for name in conftest.THREAD_VARIABLES}


def test_a_value_set_on_the_command_line_wins():
    env = {"OMP_NUM_THREADS": "8"}
    conftest.cap_threads(env)
    assert env["OMP_NUM_THREADS"] == "8" and env["LOKY_MAX_CPU_COUNT"] == str(conftest.TEST_THREADS)
