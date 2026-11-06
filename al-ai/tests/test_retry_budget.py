"""Bounded retries, the run's time budget and re-runs (AL-139). Fake providers and a fake clock: no network, no keys, no waiting."""

import json

import pytest

import test_committee as tc
from app import committee, retry_policy
from app import affordability_agent as ag
from app.llm import config

OLLAMA = config.AgentModel("ollama", "qwen3.5:9b")
ENV = {"OLLAMA_HOST": "http://ollama.test:11434"}
FACTS = ag.build_facts(
    loan=300_000, years=30, benchmark_rate=0.04, gross_annual_income=90_000, net_monthly_income=5_000,
    monthly_debts=200, monthly_living_costs=1_800, first_time_buyer=True,
)
GOOD_REPLY = tc.AFFORDABILITY


class Net:
    """A fake Ollama. `script` holds one item per call: (status, headers, body) or a reply text; the last repeats."""

    def __init__(self, *script, on_call=lambda: None):
        self.script, self.calls, self.timeouts, self.on_call = list(script), [], [], on_call

    def __call__(self, url, headers, body, timeout):
        self.calls.append(json.loads(body))
        self.timeouts.append(timeout)
        self.on_call()
        got = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if isinstance(got, tuple):
            return got
        return 200, {}, json.dumps({"message": {"content": got}}).encode()


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def run(net, budget=None, sleeps=None):
    return ag.run(FACTS, run_id="r", agent=OLLAMA, transport=net, env=ENV, budget=budget, sleep=(sleeps.append if sleeps is not None else (lambda s: None)))


# ---- criterion 1: retries ---------------------------------------------------------------------

def test_a_provider_error_is_retried_at_most_twice_after_2_then_8_seconds():
    net, sleeps = Net((503, {}, b"down")), []
    result = run(net, sleeps=sleeps)
    assert not result.ok and len(net.calls) == 3 and sleeps == [2.0, 8.0]
    assert [a["outcome"] for a in result.attempts] == ["provider_error"] * 3


def test_a_longer_retry_after_is_waited_for_and_a_shorter_one_is_not():
    net, sleeps = Net((429, {"retry-after": "20"}, b"slow down"), (429, {"retry-after": "1"}, b"slow down"), json.dumps(GOOD_REPLY)), []
    result = run(net, sleeps=sleeps)
    assert result.ok and sleeps == [20.0, 8.0]


def test_a_retry_after_we_cannot_read_is_ignored():
    net, sleeps = Net((503, {"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"}, b"down"), json.dumps(GOOD_REPLY)), []
    assert run(net, sleeps=sleeps).ok and sleeps == [2.0]


def test_a_reply_that_is_not_json_gets_one_repair_attempt_that_shows_the_model_what_was_wrong():
    net = Net("not json at all", json.dumps(GOOD_REPLY))
    result = run(net)
    assert result.ok and [a["outcome"] for a in result.attempts] == ["invalid_reply", "ok"]
    assert "rejected" in net.calls[1]["messages"][-1]["content"] or "rejected" in json.dumps(net.calls[1])


def test_a_reply_that_stays_bad_fails_after_the_one_repair_attempt():
    net = Net("not json at all")
    result = run(net)
    assert not result.ok and len(net.calls) == 2 and "JSON" in result.failure_reason


def test_each_call_is_limited_to_60_seconds():
    net = Net(json.dumps(GOOD_REPLY))
    run(net)
    assert net.timeouts == [60.0]


# ---- criterion 2: the time budget -------------------------------------------------------------

def test_a_call_gets_only_the_time_the_budget_has_left():
    clock = Clock()
    clock.now = 0.0
    budget = retry_policy.Budget(300, clock)
    clock.now = 270.0
    net = Net(json.dumps(GOOD_REPLY))
    assert run(net, budget=budget).ok and net.timeouts == [pytest.approx(30.0)]


def test_a_pause_the_budget_cannot_cover_ends_the_step_with_the_budget_as_the_reason():
    clock = Clock()
    budget = retry_policy.Budget(10, clock)
    net, result = Net((503, {}, b"down")), None
    result = ag.run(FACTS, run_id="r", agent=OLLAMA, transport=net, env=ENV, budget=budget, sleep=clock.sleep)
    # call 1 fails, waits 2 s (8 s left), call 2 fails, the 8 s pause would use all that is left: stop
    assert not result.ok and len(net.calls) == 2 and clock.now == 2.0
    assert result.failure_reason == "the run's time budget of 10 s ran out"


def test_a_step_that_starts_after_the_budget_is_spent_makes_no_call():
    clock = Clock()
    budget = retry_policy.Budget(5, clock)
    clock.now = 6.0
    net = Net(json.dumps(GOOD_REPLY))
    result = run(net, budget=budget)
    assert not result.ok and net.calls == [] and "time budget" in result.failure_reason


def test_when_the_budget_runs_out_mid_run_the_run_is_saved_as_failed_with_the_evidence_so_far_and_no_recommendation():
    clock = Clock()
    class Slow(tc.Providers):
        def __call__(self, url, headers, body, timeout):
            if "ollama.test" in url:
                clock.now += 301  # the affordability model takes longer than the whole run's budget
            return super().__call__(url, headers, body, timeout)

    store = tc.MemoryRunStore()
    deps = committee.Deps(
        store=store, report_store=tc.a_report_for_today(), official=tc.OFFICIAL, benchmark_rate_pct=4.0, today=tc.TODAY,
        agents=tc.AGENTS, transport=Slow(), env=tc.ENV, sleep=clock.sleep, clock=clock,
    )
    record = committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1")
    assert record["status"] == "failed" and "time budget" in record["failure_reason"]
    assert record["failed_step"] in ("affordability", "valuation_agent")
    assert record["original_recommendation"] is None and record["effective_recommendation"] is None
    assert "strategist" not in record["steps"] and "policy_gate" not in record["steps"]
    assert record["steps"]["calculations"]["ok"] is True and store.saved == [record]  # the evidence so far is kept


def test_a_step_reached_after_the_budget_is_spent_is_recorded_as_failed_without_running():
    clock = Clock()
    clock.now = 1000.0
    deps = committee.Deps(
        store=tc.MemoryRunStore(), report_store=tc.a_report_for_today(), official=tc.OFFICIAL, benchmark_rate_pct=4.0,
        today=tc.TODAY, agents=tc.AGENTS, transport=tc.Providers(), env=tc.ENV, sleep=clock.sleep, clock=clock, budget_s=0,
    )
    record = committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1")
    assert record["status"] == "failed" and record["failed_step"] == "validate" and record["failure_reason"] == "the run's time budget of 0 s ran out"


# ---- criterion 3: re-run ----------------------------------------------------------------------

def test_a_re_run_has_a_new_run_id_linked_to_the_failed_run_and_leaves_the_failed_record_alone():
    failed, _, _ = tc.go(tc.MORTGAGE, tc.Providers(ollama=(503, b"down")))
    before = json.dumps(failed, sort_keys=True)
    store = tc.MemoryRunStore()
    deps = committee.Deps(
        store=store, report_store=tc.a_report_for_today(), official=tc.OFFICIAL, benchmark_rate_pct=4.0, today=tc.TODAY,
        agents=tc.AGENTS, transport=tc.Providers(), env=tc.ENV, sleep=lambda s: None,
    )
    again = committee.rerun_committee(failed, tc.MORTGAGE, deps=deps)
    assert again["run_id"] != failed["run_id"] and again["rerun_of"] == failed["run_id"]
    assert again["application_id"] == failed["application_id"] and again["status"] == "complete" and store.saved == [again]
    assert json.dumps(failed, sort_keys=True) == before and failed["rerun_of"] is None


def test_only_a_failed_run_can_be_re_run():
    complete, _, _ = tc.go(tc.MORTGAGE)
    deps = committee.Deps(store=tc.MemoryRunStore(), report_store=tc.a_report_for_today(), official=tc.OFFICIAL, benchmark_rate_pct=4.0)
    with pytest.raises(ValueError, match="did not fail"):
        committee.rerun_committee(complete, tc.MORTGAGE, deps=deps)


def test_a_first_run_is_not_linked_to_anything():
    record, _, _ = tc.go(tc.MORTGAGE)
    assert record["rerun_of"] is None
