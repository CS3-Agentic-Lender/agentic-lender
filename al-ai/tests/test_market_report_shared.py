"""The listener's runs share one market report store, so the day's report is made once (the underwriter story's market research agent).

Two committee runs go through `auto_start.deps_factory_for`, the way the listener builds them. Fake providers and a fake search: no network, no Firestore.
"""

import dataclasses

import test_committee as tc
import test_market_agent as tma
from app import auto_start, committee, rates
from app import market_agent as ma


class CountingSearch:
    """A fake Serper that counts its calls."""

    def __init__(self):
        self.calls = 0

    def __call__(self, query, **kw):
        self.calls += 1
        return tma.results()[0]


def providers_for(*, makes_report: bool):
    """Gemini answers the market step first (only when the run has to make a report), then the strategist."""
    providers = tc.Providers()
    providers.replies["generativelanguage"] = ([tma.GOOD] if makes_report else []) + [tc.strategist()]
    return providers


def run(factory, search, *, makes_report, today=tc.TODAY, get_rate=tc.get_rate):
    deps = dataclasses.replace(
        factory(tc.MemoryRunStore()), get_rate=get_rate, today=today, agents=tc.AGENTS, transport=providers_for(makes_report=makes_report),
        sleep=lambda s: None, search=search, call_sink=None,
    )
    record = committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1")
    assert record["status"] == "complete"
    return record["steps"]["market"], deps


def test_every_run_the_listener_starts_shares_one_report_store():
    factory = auto_start.deps_factory_for(object(), tc.ENV)
    assert factory(tc.MemoryRunStore()).report_store is factory(tc.MemoryRunStore()).report_store
    assert factory(tc.MemoryRunStore()).report_store is not auto_start.deps_factory_for(object(), tc.ENV)(tc.MemoryRunStore()).report_store


def test_a_second_run_on_the_same_day_reuses_the_first_runs_report_and_calls_neither_gemini_nor_serper():
    factory, search = auto_start.deps_factory_for(object(), tc.ENV), CountingSearch()
    first, _ = run(factory, search, makes_report=True)
    assert first["reused_report_id"] is None and search.calls == len(tma.ma.QUERIES)

    second_search = CountingSearch()
    second, deps = run(factory, second_search, makes_report=False)  # no Gemini answer for a market report is queued: a call would break the run
    assert second["reused_report_id"] == first["report_id"] and second["report_id"] == first["report_id"]
    assert second_search.calls == 0


def test_a_run_after_the_official_figures_change_makes_a_new_report():
    factory = auto_start.deps_factory_for(object(), tc.ENV)
    first, _ = run(factory, CountingSearch(), makes_report=True)
    other = dict(tc.RATES, mortgage_ie=rates.Rate("mortgage_ie", 5.5, "2026-09", 4.5, "2025-09", tc.FETCHED))
    search = CountingSearch()
    second, _ = run(factory, search, makes_report=True, get_rate=lambda name: other[name])
    assert second["reused_report_id"] is None and second["report_id"] != first["report_id"] and search.calls == len(tma.ma.QUERIES)


def test_a_run_on_a_new_day_makes_a_new_report():
    factory = auto_start.deps_factory_for(object(), tc.ENV)
    first, _ = run(factory, CountingSearch(), makes_report=True)
    search = CountingSearch()
    second, _ = run(factory, search, makes_report=True, today="2026-10-24")
    assert second["reused_report_id"] is None and second["report_id"] != first["report_id"] and search.calls == len(tma.ma.QUERIES)
