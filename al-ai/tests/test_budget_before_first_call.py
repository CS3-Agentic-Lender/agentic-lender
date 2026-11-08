"""A run whose time budget runs out before a model step makes its first call is saved as failed with that step and the
budget reason, not as an IndexError (AL-294). Each model step is tested through the whole flow with a fake clock.

The clock jumps past the 300 s budget after the step has been let in and before its first model call, which is the gap the bug was in.
"""

import pytest

import test_committee as tc
from app import committee
from app import market_agent as ma
from test_market_agent import results as search_results

BUDGET_REASON = "the run's time budget of 300 s ran out"


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def run_with_budget_spent_inside(step, monkeypatch):
    """Run the committee; the budget runs out just as `step` starts its work, before it can call a model."""
    clock = Clock()
    real_node = committee._node

    def node(name, work, budget):
        if name != step:
            return real_node(name, work, budget)

        def spend_then_work(state):
            clock.now += 301
            return work(state)

        return real_node(name, spend_then_work, budget)

    monkeypatch.setattr(committee, "_node", node)
    market_store = ma.MemoryReportStore() if step == "market" else tc.a_report_for_today()

    def search(*args, **kwargs):  # only reached by the market step, which has no stored report in that test
        return search_results()[0]

    deps = committee.Deps(
        store=tc.MemoryRunStore(), report_store=market_store, official=tc.OFFICIAL, benchmark_rate_pct=4.0, today=tc.TODAY,
        agents=tc.AGENTS, transport=tc.Providers(), env=tc.ENV, sleep=clock.sleep, clock=clock, search=search,
    )
    return committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1")


@pytest.mark.parametrize("step", ["affordability", "valuation_agent", "strategist"])
def test_a_model_step_that_starts_with_no_time_left_fails_with_the_budget_reason(step, monkeypatch):
    record = run_with_budget_spent_inside(step, monkeypatch)
    assert record["status"] == "failed"
    assert "IndexError" not in str(record) and "unexpected error" not in record["failure_reason"]
    assert record["steps"][step] == {"ok": False, "error": BUDGET_REASON}
    assert record["failure_reason"] == BUDGET_REASON
    if step == "affordability":
        assert record["failed_step"] == "affordability"
    assert record["original_recommendation"] is None and record["effective_recommendation"] is None


def test_the_market_step_that_starts_with_no_time_left_fails_with_the_budget_reason(monkeypatch):
    record = run_with_budget_spent_inside("market", monkeypatch)
    assert record["status"] == "failed" and record["failed_step"] == "market"
    assert record["failure_reason"] == BUDGET_REASON
    assert "IndexError" not in str(record)
    assert record["steps"]["market"]["attempts"] == []  # no call was made, and the evidence says so
