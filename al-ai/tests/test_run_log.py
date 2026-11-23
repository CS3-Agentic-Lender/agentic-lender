"""The committee's progress lines on stdout (app/run_log.py): one JSON object per claim, step start, step end and finish, with
no borrower data in any of them. The committee runs on the same fake providers as test_committee."""

import copy
import json

import pytest
from botocore.credentials import Credentials

import test_committee as tc
from app import auto_start, committee, rates, run_log
from app.llm import clients, config

KEYS = {"call", "event", "run_id", "application_id", "rerun_of", "step", "status", "provider", "model", "attempt", "duration_ms", "reason"}
STEPS = ["validate", "valuation_model", "market", "calculations", "affordability", "valuation_agent", "strategist", "policy_gate"]
PERSONAL = {"borrowerName": "Siobhan Testperson", "email": "siobhan.testperson@example.test", "borrowerUid": "uid-borrower-7f3k"}
APPLICATION = {**copy.deepcopy(tc.MORTGAGE), **PERSONAL}


def deps(providers=None, get_rate=tc.get_rate, agents=tc.AGENTS):
    return committee.Deps(
        store=tc.MemoryRunStore(), report_store=tc.a_report_for_today(), get_rate=get_rate, today=tc.TODAY, agents=agents,
        transport=providers or tc.Providers(), env=tc.ENV, sleep=lambda s: None,
        search=lambda *a, **k: pytest.fail("the day's report exists, so no search should run"),
    )


def lines(capsys) -> list[dict]:
    out = capsys.readouterr().out
    parsed = [json.loads(line) for line in out.splitlines()]
    assert all(set(line) == KEYS and line["call"] == "committee" for line in parsed)
    return parsed


@pytest.fixture
def printed(capsys):
    """Reads the lines printed so far. Each test calls run_log.send_to_stdout() itself, as the start-up does: a handler made
    during fixture set-up would hold a stdout that pytest swaps out before the test runs."""
    return lambda: lines(capsys)


def test_a_complete_run_logs_each_step_start_and_end_then_its_finish(printed):
    run_log.send_to_stdout()
    record = committee.run_committee(APPLICATION, deps=deps(), application_id="app-1")
    got = printed()
    assert [(line["event"], line["step"], line["status"]) for line in got[:6]] == [
        ("step", "validate", "started"), ("step", "validate", "ok"),
        ("step", "valuation_model", "started"), ("step", "valuation_model", "ok"),
        ("step", "market", "started"), ("step", "market", "ok"),
    ]
    steps = [line for line in got if line["event"] == "step"]
    assert sorted((line["step"], line["status"]) for line in steps) == sorted((s, st) for s in STEPS for st in ("started", "ok"))
    assert got[-1] == {**got[-1], "event": "finished", "status": "complete", "step": None, "reason": None}
    assert all(line["run_id"] == record["run_id"] and line["application_id"] == "app-1" for line in got)


def test_a_bedrock_step_names_bedrock_and_its_model(printed, monkeypatch):
    run_log.send_to_stdout()
    monkeypatch.setattr(clients, "aws_credentials", lambda: Credentials("AKIDEXAMPLE", "made-up", "tok"))
    providers = tc.Providers()

    def network(url, headers, body, timeout):
        if "bedrock-runtime" in url:
            reply = {"output": {"message": {"content": [{"text": json.dumps(tc.AFFORDABILITY)}]}}, "usage": {"inputTokens": 1, "outputTokens": 1}}
            return 200, {"x-amzn-requestid": "req-1"}, json.dumps(reply).encode()
        return providers(url, headers, body, timeout)

    agents = {**tc.AGENTS, "affordability": config.AgentModel("bedrock", "qwen.qwen3-32b-v1:0")}
    committee.run_committee(APPLICATION, deps=deps(network, agents=agents), application_id="app-1")
    affordability = [line for line in printed() if line["step"] == "affordability" and line["event"] == "step"]
    assert [(line["status"], line["provider"], line["model"]) for line in affordability] == [
        ("started", "bedrock", "qwen.qwen3-32b-v1:0"), ("ok", "bedrock", "qwen.qwen3-32b-v1:0"),
    ]
    assert affordability[1]["attempt"] == 1 and isinstance(affordability[1]["duration_ms"], int)


def test_a_failed_market_step_ends_the_run_with_that_step_and_its_reason(printed):
    run_log.send_to_stdout()

    def no_rate(name):
        raise rates.RateUnavailable("the ECB could not be reached (URLError: timed out); and there is no cached mortgage_ie rate")

    committee.run_committee(APPLICATION, deps=deps(get_rate=no_rate), application_id="app-1")
    got = printed()
    assert [line["step"] for line in got if line["event"] == "step"] == ["validate", "validate", "valuation_model", "valuation_model", "market", "market"]
    assert got[-1]["event"] == "finished" and got[-1]["status"] == "failed" and got[-1]["step"] == "market"
    assert got[-1]["reason"].startswith("StepFailed: the ") and "the ECB could not be reached (URLError: timed out)" in got[-1]["reason"]
    assert got[-2]["status"] == "failed" and got[-2]["reason"] == got[-1]["reason"]


def test_a_failed_agent_step_logs_only_the_class_name(printed):
    run_log.send_to_stdout()
    committee.run_committee(APPLICATION, deps=deps(tc.Providers(ollama=(500, b"down 95000"))), application_id="app-1")
    got = printed()
    assert got[-1]["status"] == "failed" and got[-1]["step"] == "affordability" and got[-1]["reason"] == "StepFailed"
    failed = next(line for line in got if line["step"] == "affordability" and line["status"] == "failed")
    assert failed["attempt"] == 3 and failed["provider"] == "ollama" and failed["reason"] == "StepFailed"


def test_the_listener_logs_the_claim_before_the_steps(printed, monkeypatch):
    run_log.send_to_stdout()
    monkeypatch.setattr(auto_start, "claim", lambda db, application_id, **kwargs: copy.deepcopy(APPLICATION))
    record = auto_start.process(None, "app-1", deps_factory=lambda store: deps(), rerun_of="run-0")
    got = printed()
    assert got[0] == {**got[0], "event": "claimed", "status": "started", "run_id": record["run_id"], "rerun_of": "run-0"}
    assert got[-1]["event"] == "finished" and all(line["rerun_of"] == "run-0" for line in got)


def test_no_line_holds_the_borrowers_name_email_uid_or_figures(printed):
    run_log.send_to_stdout()
    committee.run_committee(APPLICATION, deps=deps(), application_id="app-1")
    committee.run_committee(APPLICATION, deps=deps(tc.Providers(gemini={"recommendation": "Maybe", "conditions": [], "memo": tc.MEMO})), application_id="app-1")
    text = json.dumps(printed())
    figures = [str(tc.MORTGAGE[key]) for key in ("grossIncomeEur", "monthlyTakeHomeEur", "loanAmountEur", "depositEur")]
    for secret in [*PERSONAL.values(), *figures, tc.MORTGAGE["property"]["eircode"], tc.MORTGAGE["brokerId"]]:
        assert secret not in text
