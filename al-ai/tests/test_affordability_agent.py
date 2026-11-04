import json
import logging

import pytest

from app import affordability_agent as ag
from app.llm import config

OLLAMA = config.AgentModel("ollama", "qwen3.5:9b")
ENV = {"OLLAMA_HOST": "http://ollama.test:11434"}

# Reference case from AL-115: joint mover, EUR 270,000 over 25 years at a 4.00% test rate.
GOOD = dict(
    loan=270_000, years=25, benchmark_rate=0.04, gross_annual_income=90_000,
    net_monthly_income=5_600, monthly_debts=300, monthly_living_costs=2_400, first_time_buyer=False,
)
FACTS = ag.build_facts(**GOOD)
# 400,000 on 90,000 income is 4.44x, over the 3.5x cap for a non-first-time buyer (the bands stay Comfortable).
BREACH = ag.build_facts(**{**GOOD, "loan": 400_000, "gross_annual_income": 90_000})


def reply(**over):
    base = {"rating": "adequate", "recommendation": "Conditionally Approve", "concerns": ["Stressed repayment is 1739.61 a month."], "conditions": []}
    return {**base, **over}


class Net:
    """A fake Ollama: returns the replies we give it in order (the last one repeats) and remembers what it was sent."""

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, url, headers, body, timeout):
        self.calls.append(json.loads(body))
        got = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(got, Exception):
            raise got
        if isinstance(got, tuple):
            return got[0], {}, got[1]
        text = got if isinstance(got, str) else json.dumps(got)
        return 200, {}, json.dumps({"message": {"content": text}, "prompt_eval_count": 14, "eval_count": 8}).encode()


def run(net, facts=FACTS, **kw):
    return ag.run(facts, run_id="run-1", agent=OLLAMA, transport=net, env=ENV, sleep=lambda s: None, **kw)


# ---- facts: code works out every figure ---------------------------------------------------

def test_facts_match_the_reference_case():
    assert FACTS["repayment_eur"] == 1425.16 and FACTS["stressed_repayment_eur"] == 1739.61
    assert FACTS["lti_cap"] == 3.5 and FACTS["lti_cap_breached"] is False


def test_prompt_has_the_data_and_a_version():
    p = ag.build_prompt(FACTS)
    assert '"stressed_repayment_eur": 1739.61' in p and "{data}" not in p
    assert ag.PROMPT_VERSION == "affordability-agent-v1"


# ---- a good reply -------------------------------------------------------------------------

def test_good_reply_passes_first_time():
    net = Net(reply())
    r = run(net)
    assert r.ok and r.reply["recommendation"] == "Conditionally Approve" and len(r.attempts) == 1 and len(net.calls) == 1


def test_attempt_is_logged_with_everything_the_ticket_asks_for():
    a = run(Net(reply())).attempts[0]
    for key in ("run_id", "provider", "model", "prompt_version", "raw_reply", "parsed_reply", "duration_s", "outcome"):
        assert key in a
    assert (a["run_id"], a["provider"], a["model"], a["outcome"]) == ("run-1", "ollama", "qwen3.5:9b", "ok")


def test_the_model_is_sent_the_facts():
    net = Net(reply())
    run(net)
    assert "1739.61" in json.dumps(net.calls[0])


def test_the_agent_is_the_one_agents_json_names_for_affordability():
    assert config.load().agent("affordability") == OLLAMA


# ---- bad replies: one retry with the error shown, then the step fails ----------------------

def test_malformed_reply_is_retried_once_with_the_error_shown():
    net = Net("not json", reply())
    r = run(net)
    assert r.ok and [a["outcome"] for a in r.attempts] == ["invalid_reply", "ok"]
    assert "Your previous reply was rejected" in json.dumps(net.calls[1])
    assert "rejected" not in json.dumps(net.calls[0])


def test_two_bad_replies_fail_the_step_with_the_reason():
    net = Net("not json", "still not json")
    r = run(net)
    assert not r.ok and r.reply is None and r.failure_reason
    assert len(r.attempts) == 2 and len(net.calls) == 2  # no third call, no other provider


@pytest.mark.parametrize("bad, text", [
    ({"rating": "adequate"}, "exactly"),
    (reply(rating=["strong"]), "rating"),
    (reply(recommendation={"x": 1}), "recommendation"),
    (reply(rating=None), "rating"),
    (reply(rating="great"), "rating"),
    (reply(recommendation="Maybe"), "recommendation"),
    (reply(concerns="one long string"), "concerns"),
    (reply(concerns=["x"] * 6), "at most 5"),
    (reply(conditions=[""]), "non-empty"),
    ([1, 2], "one JSON object"),
])
def test_schema_checks(bad, text):
    with pytest.raises(ag.ReplyRejected, match=text):
        ag.check_reply(bad, FACTS)


# ---- semantic checks: no figure we didn't give it -------------------------------------------

def test_invented_figure_is_rejected():
    with pytest.raises(ag.ReplyRejected, match="777"):
        ag.check_reply(reply(concerns=["Repayment would be 777 a month."]), FACTS)


def test_supplied_figures_with_commas_and_rounding_are_accepted():
    ag.check_reply(reply(concerns=["Loan of 270,000 over 25 years, repayment 1425.16, stressed about 1740."]), FACTS)


def test_negative_figures_can_be_quoted():
    # net income 3,000 leaves a stressed surplus of -1439.61 (Adverse): the Adverse cases are the point.
    short = ag.build_facts(**{**GOOD, "net_monthly_income": 3_000})
    assert short["stressed_surplus_eur"] == -1439.61
    ag.check_reply(reply(rating="unaffordable", recommendation="Decline", concerns=["Stressed surplus is -1439.61 a month."]), short)
    ag.check_reply(reply(rating="unaffordable", recommendation="Decline", concerns=["The household is short by 1,439.61 a month."]), short)


# ---- the reply cannot clear a band or a cap breach ----------------------------------------

def test_approve_is_rejected_when_the_cap_is_breached():
    assert BREACH["lti_cap_breached"] is True
    with pytest.raises(ag.ReplyRejected, match="cannot recommend Approve"):
        ag.check_reply(reply(recommendation="Approve", concerns=[]), BREACH)


def test_approve_is_rejected_when_a_band_is_adverse():
    adverse = {**FACTS, "dti_band": "Adverse", "lti_cap_breached": False}
    with pytest.raises(ag.ReplyRejected, match="cannot recommend Approve"):
        ag.check_reply(reply(recommendation="Approve", concerns=[]), adverse)


def test_reply_cannot_change_a_band():
    # The reply has no band field (extra fields are rejected) and the check never touches the facts.
    adverse = {**FACTS, "surplus_band": "Adverse"}
    with pytest.raises(ag.ReplyRejected, match="exactly"):
        ag.check_reply({**reply(), "surplus_band": "Comfortable"}, adverse)
    assert adverse["surplus_band"] == "Adverse"


def test_a_reply_that_tries_to_approve_a_breach_is_retried_then_fails():
    net = Net(reply(recommendation="Approve", concerns=[]))
    r = run(net, BREACH)
    assert not r.ok and "cannot recommend Approve" in r.failure_reason and len(r.attempts) == 2


# ---- provider trouble (now retried like every other step) ---------------------------------

def test_a_provider_outage_is_retried_with_a_pause_and_then_fails():
    pauses = []
    r = ag.run(FACTS, run_id="r", agent=OLLAMA, transport=Net((503, b"down")), env=ENV, sleep=pauses.append)
    assert not r.ok and len(r.attempts) == 3 and pauses == [1.0, 2.0]
    assert all(a["outcome"] == "provider_error" for a in r.attempts)


def test_a_bad_request_is_not_retried():
    assert len(run(Net((400, b"bad"))).attempts) == 1


def test_a_bug_in_our_own_code_is_not_hidden_as_a_provider_error():
    with pytest.raises(RuntimeError):
        run(Net(RuntimeError("our bug")))


def test_every_attempt_is_logged_with_the_prompt_version(caplog):
    with caplog.at_level(logging.INFO, logger="al-ai.affordability-agent"):
        run(Net(reply(recommendation="Maybe"), reply()))
    logged = [json.loads(r.message) for r in caplog.records]
    assert [a["outcome"] for a in logged] == ["invalid_reply", "ok"]
    assert all(a["prompt_version"] == "affordability-agent-v1" and "duration_s" in a for a in logged)
