import json

import pytest

from app import affordability_agent as ag

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
    return json.dumps({**base, **over})


class Fake:
    """A model that returns the replies we give it in order, and remembers what it was sent."""

    def __init__(self, *replies):
        self.replies, self.prompts = list(replies), []

    def __call__(self, prompt):
        self.prompts.append(prompt)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def run(fake, facts=FACTS):
    return ag.run(facts, fake, model="test-model", run_id="run-1")


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
    r = run(Fake(reply()))
    assert r.ok and r.reply["recommendation"] == "Conditionally Approve" and len(r.attempts) == 1


def test_attempt_is_logged_with_everything_the_ticket_asks_for():
    a = run(Fake(reply())).attempts[0]
    for key in ("run_id", "provider", "model", "prompt_version", "raw_reply", "parsed_reply", "duration_s", "outcome"):
        assert key in a
    assert (a["run_id"], a["provider"], a["model"], a["outcome"]) == ("run-1", "ollama", "test-model", "ok")


def test_think_tags_are_stripped():
    assert run(Fake("<think>hmm</think>" + reply())).ok


# ---- bad replies: one retry with the error shown, then the step fails ----------------------

def test_malformed_reply_is_retried_once_with_the_error_shown():
    fake = Fake("not json", reply())
    r = run(fake)
    assert r.ok and [a["outcome"] for a in r.attempts] == ["invalid_reply", "ok"]
    assert "rejected" in fake.prompts[1] and "not valid JSON" in fake.prompts[1]
    assert "rejected" not in fake.prompts[0]


def test_two_bad_replies_fail_the_step_with_the_reason():
    fake = Fake("not json", "still not json")
    r = run(fake)
    assert not r.ok and r.reply is None and "not valid JSON" in r.failure_reason
    assert len(r.attempts) == 2 and len(fake.prompts) == 2  # no third call, no other provider


@pytest.mark.parametrize("bad, text", [
    (json.dumps({"rating": "adequate"}), "exactly"),
    (reply(rating=["strong"]), "rating"),
    (reply(recommendation={"x": 1}), "recommendation"),
    (reply(rating=None), "rating"),
    (reply(rating="great"), "rating"),
    (reply(recommendation="Maybe"), "recommendation"),
    (reply(concerns="one long string"), "concerns"),
    (reply(concerns=["x"] * 6), "at most 5"),
    (reply(conditions=[""]), "non-empty"),
    ("[1, 2]", "one JSON object"),
])
def test_schema_checks(bad, text):
    with pytest.raises(ag.InvalidReply, match=text):
        ag.validate(bad, FACTS)


# ---- semantic checks: no figure we didn't give it -------------------------------------------

def test_invented_figure_is_rejected():
    with pytest.raises(ag.InvalidReply, match="777"):
        ag.validate(reply(concerns=["Repayment would be 777 a month."]), FACTS)


def test_supplied_figures_with_commas_and_rounding_are_accepted():
    ag.validate(reply(concerns=["Loan of 270,000 over 25 years, repayment 1425.16, stressed about 1740."]), FACTS)


def test_negative_figures_can_be_quoted():
    # net income 3,000 leaves a stressed surplus of -1439.61 (Adverse): the Adverse cases are the point.
    short = ag.build_facts(**{**GOOD, "net_monthly_income": 3_000})
    assert short["stressed_surplus_eur"] == -1439.61
    ag.validate(reply(rating="unaffordable", recommendation="Decline", concerns=["Stressed surplus is -1439.61 a month."]), short)
    ag.validate(reply(rating="unaffordable", recommendation="Decline", concerns=["The household is short by 1,439.61 a month."]), short)


# ---- the reply cannot clear a band or a cap breach ----------------------------------------

def test_approve_is_rejected_when_the_cap_is_breached():
    assert BREACH["lti_cap_breached"] is True
    with pytest.raises(ag.InvalidReply, match="cannot recommend Approve"):
        ag.validate(reply(recommendation="Approve", concerns=[]), BREACH)


def test_approve_is_rejected_when_a_band_is_adverse():
    adverse = {**FACTS, "dti_band": "Adverse", "lti_cap_breached": False}
    with pytest.raises(ag.InvalidReply, match="cannot recommend Approve"):
        ag.validate(reply(recommendation="Approve", concerns=[]), adverse)


def test_reply_cannot_change_a_band():
    # The reply has no band field (extra fields are rejected) and validate never touches the facts.
    adverse = {**FACTS, "surplus_band": "Adverse"}
    with pytest.raises(ag.InvalidReply, match="exactly"):
        ag.validate(json.dumps({**json.loads(reply()), "surplus_band": "Comfortable"}), adverse)
    assert adverse["surplus_band"] == "Adverse"


def test_a_reply_that_tries_to_approve_a_breach_is_retried_then_fails():
    fake = Fake(reply(recommendation="Approve", concerns=[]), reply(recommendation="Approve", concerns=[]))
    r = run(fake, BREACH)
    assert not r.ok and "cannot recommend Approve" in r.failure_reason


# ---- provider trouble ---------------------------------------------------------------------

def test_wrongly_typed_field_is_an_invalid_reply_and_gets_the_repair_attempt():
    r = run(Fake(reply(rating=["strong"]), reply()))
    assert r.ok and [a["outcome"] for a in r.attempts] == ["invalid_reply", "ok"]


def test_a_bug_in_our_own_code_is_not_hidden_as_a_provider_error():
    with pytest.raises(RuntimeError):
        run(Fake(RuntimeError("our bug")))


def test_provider_error_fails_without_a_second_call():
    fake = Fake(ConnectionError("refused"))
    r = run(fake)
    assert not r.ok and r.attempts[0]["outcome"] == "provider_error" and len(fake.prompts) == 1
