"""A committee run waits out a slow ECB, and the listener fills the rates cache when it starts. Fake network, no Firestore."""

import logging
import threading

from app import auto_start, committee, rates
from app.llm import smoke
from test_rates import NOW, Net


def test_a_committee_run_asks_the_ecb_with_the_long_timeout(monkeypatch):
    asked = []
    monkeypatch.setattr(rates, "get_rate", lambda name, **kw: asked.append((name, kw)))
    committee.local_deps(store=None, env={}, report_store=None).get_rate("ecb_mrr")
    assert asked == [("ecb_mrr", {"timeout": rates.BACKGROUND_TIMEOUT_S})]
    assert rates.BACKGROUND_TIMEOUT_S > 16 > rates.TIMEOUT_S  # a cold ECB reply took 16 s


def test_the_warm_up_writes_every_series_to_the_cache():
    cache = rates.MemoryCache()
    auto_start.warm_rates(lambda name: rates.get_rate(name, cache=cache, transport=Net(), now=NOW))
    assert set(cache.docs) == set(rates.SERIES)


def test_a_failing_warm_up_logs_and_does_not_raise(caplog):
    def down(name):
        raise rates.RateUnavailable("the ECB could not be reached")

    with caplog.at_level(logging.WARNING):
        auto_start.warm_rates(down)
    assert caplog.text.count("could not warm") == len(rates.SERIES)


def test_the_listener_starts_without_waiting_for_the_warm_up(monkeypatch):
    started, release, warmed_with = threading.Event(), threading.Event(), []

    def slow_warm(get_rate):
        warmed_with.append(get_rate)
        started.set()
        release.wait(5)

    class StandIn:
        def __init__(self, db, factory):
            pass

        def start(self):
            pass

    monkeypatch.setattr(smoke, "load_env", lambda: {})
    monkeypatch.setattr(auto_start.firestore, "Client", lambda project: object())
    monkeypatch.setattr(auto_start, "Listener", StandIn)
    monkeypatch.setattr(auto_start, "deps_factory_for", lambda db, env: None)
    monkeypatch.setattr(auto_start, "warm_rates", slow_warm)
    try:
        assert isinstance(auto_start.start_from_env(), StandIn)  # returned while the warm-up is still blocked
        assert started.wait(5) and warmed_with == [committee.get_rate_waiting]
    finally:
        release.set()
