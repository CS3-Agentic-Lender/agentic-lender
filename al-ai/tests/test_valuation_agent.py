"""The valuation agent step: one committee step that explains numbers our own code already worked out.

Tested with a fake network. A real run on a made-up application is in the live test at the bottom (opt in with AL_LIVE_LLM=1).
"""

import json
import logging
import os
import re

import pytest

from app import valuation_agent as va
from app import valuation_checks
from app.llm import clients, config

KEY = "SECRET-KEY-do-not-leak-0123456789"
ENV = {"GROQ_API_KEY": KEY, "MISTRAL_API_KEY": KEY, "GEMINI_API_KEY": KEY}
GROQ = config.AgentModel("groq", "openai/gpt-oss-120b")
MISTRAL = config.AgentModel("mistral", "mistral-small-2603")

HOME = dict(county="Cork", property_type="Semi-D", bedrooms=3, floor_area_m2=111.0, ber="B", routing_key="T12")


def facts(**changes):
    base = dict(**HOME, asking_price_eur=380_000.0, loan_eur=342_000.0, estimate_eur=340_000.0, review_threshold=0.3567, support_warnings=())
    return va.build_facts(**{**base, **changes})


GOOD = {
    "rating": "weak",
    "recommendation": "Conditionally Approve",
    "conditions": ["Get an independent surveyor's valuation before funding."],
    "explanation": "The asking price is above our estimate and the loan to value on the lower value is over the limit. The estimate is only an indicative 2024 asking-price estimate.",
}


# ---- the prompt ---------------------------------------------------------------------------------

def test_the_prompt_is_a_versioned_file_with_the_five_parts_in_order():
    text = va.PROMPT
    parts = re.findall(r"^## (\w+)", text, re.M)
    assert parts == ["Role", "Task", "Rules", "Data", "Output"]
    assert "{data}" in text
    assert va.PROMPT_VERSION == "valuation-agent-v2" and va.PROMPT_PATH.name == "valuation_agent_v2.md"


def test_the_prompt_carries_the_facts_and_the_output_rules():
    prompt = va.build_prompt(facts())
    assert "{data}" not in prompt and '"estimate_eur": 340000.0' in prompt
    assert "Conditionally Approve" in prompt and "must not recommend Approve" in prompt


# ---- the facts: code works out every number ---------------------------------------------------------------

def test_the_facts_come_from_the_shared_checks_not_from_the_agent():
    f = facts()
    c = valuation_checks.check_valuation(estimate=340_000, loan=342_000, asking_price=380_000, review_threshold=0.3567)
    assert f["price_gap_pct"] == round(c.price_gap * 100, 2) and f["price_needs_review"] is c.needs_review
    assert f["purchase_ltv_pct"] == round(c.purchase_ltv * 100, 2) and f["model_ltv_pct"] == round(c.model_ltv * 100, 2)
    assert f["purchase_ltv_within_limit"] is True and f["model_ltv_within_limit"] is False  # the doc's example: 90% then 100.6%
    assert f["model_ltv_pct"] == pytest.approx(100.59, abs=0.01) and f["ltv_limit_pct"] == 90.0


def test_with_no_asking_price_the_gap_and_the_purchase_ltv_are_null():
    f = facts(asking_price_eur=None)
    assert f["asking_price_eur"] is None and f["price_gap_pct"] is None and f["price_needs_review"] is None
    assert f["purchase_ltv_pct"] is None and f["model_ltv_pct"] == pytest.approx(100.59, abs=0.01)


def test_the_facts_hold_no_personal_data_and_only_the_routing_key():
    text = json.dumps(facts())
    assert "T12" in text and "eircode" not in text.lower().replace("eircode_area", "") and "@" not in text


def test_the_support_warnings_are_passed_through_unchanged():
    assert facts(support_warnings=("The model has not seen Eircode area Z99.",))["support_warnings"] == ["The model has not seen Eircode area Z99."]


# ---- checking a reply -----------------------------------------------------------------------------------------

def test_a_good_reply_passes():
    assert va.check_reply(GOOD, facts()) == GOOD


@pytest.mark.parametrize("change", [
    {"rating": "great"}, {"recommendation": "Maybe"}, {"conditions": "one string"}, {"conditions": [""]}, {"conditions": [5]},
    {"conditions": ["short."] * 6}, {"explanation": ""}, {"explanation": "x" * 1000}, {"explanation": 7},
])
def test_a_reply_with_a_bad_field_is_rejected(change):
    with pytest.raises(va.ReplyRejected):
        va.check_reply({**GOOD, **change}, facts())


@pytest.mark.parametrize("reply", [{k: v for k, v in GOOD.items() if k != "explanation"}, {**GOOD, "extra": "x"}, []])
def test_a_reply_with_the_wrong_fields_is_rejected(reply):
    with pytest.raises(va.ReplyRejected):
        va.check_reply(reply, facts())


def test_a_reply_that_quotes_a_figure_it_was_not_given_is_rejected():
    with pytest.raises(va.ReplyRejected, match="777"):
        va.check_reply({**GOOD, "explanation": "The price is 777 euro too high."}, facts())
    with pytest.raises(va.ReplyRejected, match="12345"):
        va.check_reply({**GOOD, "conditions": ["Cap the loan at 12,345 euro."]}, facts())


def test_figures_that_are_in_the_facts_are_allowed_in_any_format():
    reply = {**GOOD, "explanation": "The asking price of 380,000 is 11.76 percent above the 340000.0 estimate and the model LTV is 100.6 against the 90 limit."}
    assert va.check_reply(reply, facts())["rating"] == "weak"


def test_a_reply_cannot_recommend_approve_when_the_code_says_the_price_needs_review():
    f = facts(asking_price_eur=500_000.0, loan_eur=100_000.0, estimate_eur=340_000.0)
    assert f["price_needs_review"] is True and f["model_ltv_within_limit"] is True
    with pytest.raises(va.ReplyRejected, match="Approve"):
        va.check_reply({**GOOD, "recommendation": "Approve", "explanation": "Fine."}, f)


def test_a_reply_cannot_recommend_approve_when_a_loan_to_value_is_over_the_limit():
    with pytest.raises(va.ReplyRejected, match="Approve"):
        va.check_reply({**GOOD, "recommendation": "Approve"}, facts())


def test_approve_is_allowed_when_the_numbers_are_clean():
    f = facts(asking_price_eur=350_000.0, loan_eur=250_000.0, estimate_eur=345_000.0)
    assert f["price_needs_review"] is False and f["model_ltv_within_limit"] is True
    assert va.check_reply({**GOOD, "rating": "strong", "recommendation": "Approve", "conditions": [], "explanation": "In line."}, f)["recommendation"] == "Approve"


# ---- a HELOC: no asking price, judged on combined LTV ----------------------------------------------------------------

def heloc_facts(**changes):
    base = dict(**HOME, loan_type="heloc", asking_price_eur=None, existing_mortgage_balance_eur=200_000.0, loan_eur=60_000.0,
                estimate_eur=400_000.0, review_threshold=0.3567, support_warnings=())
    return va.build_facts(**{**base, **changes})


def test_a_heloc_gets_its_combined_ltv_and_none_of_the_purchase_figures():
    f = heloc_facts()
    assert f["loan_type"] == "heloc" and f["combined_ltv_pct"] == 65.0  # (200,000 + 60,000) / 400,000
    assert f["combined_ltv_within_limit"] is True and f["combined_ltv_limit_pct"] == 80.0
    assert f["existing_mortgage_balance_eur"] == 200_000.0 and f["line_eur"] == 60_000.0
    for gone in ("asking_price_eur", "price_gap_pct", "price_needs_review", "purchase_ltv_pct", "model_ltv_pct", "loan_eur"):
        assert gone not in f


def test_a_purchase_is_labelled_and_keeps_its_figures():
    f = facts()
    assert f["loan_type"] == "mortgage" and "combined_ltv_pct" not in f and f["purchase_ltv_pct"] is not None


def test_a_heloc_combined_ltv_exactly_at_80_percent_is_within_the_limit_and_just_over_is_not():
    assert heloc_facts(loan_eur=120_000.0)["combined_ltv_within_limit"] is True
    assert heloc_facts(loan_eur=120_004.0)["combined_ltv_within_limit"] is False


def test_a_heloc_never_takes_an_asking_price_and_needs_the_balance():
    with pytest.raises(ValueError):
        heloc_facts(asking_price_eur=450_000.0)
    with pytest.raises(ValueError):
        heloc_facts(existing_mortgage_balance_eur=None)
    with pytest.raises(ValueError):
        facts(existing_mortgage_balance_eur=100_000.0)  # a purchase has no existing balance
    with pytest.raises(ValueError):
        facts(loan_type="bridging")


HELOC_GOOD = {
    "rating": "adequate", "recommendation": "Conditionally Approve", "conditions": [],
    "explanation": "The combined loan to value is 65.0 against the 80 limit. The estimate is only an indicative 2024 asking-price estimate.",
}


def test_a_good_heloc_reply_quoting_the_combined_ltv_passes():
    assert va.check_reply(HELOC_GOOD, heloc_facts()) == HELOC_GOOD


def test_a_heloc_reply_cannot_recommend_approve_over_the_combined_ltv_limit():
    f = heloc_facts(loan_eur=130_000.0)
    with pytest.raises(va.ReplyRejected, match="Approve"):
        va.check_reply({**HELOC_GOOD, "recommendation": "Approve", "explanation": "Fine."}, f)


def test_a_heloc_reply_may_approve_within_the_limit():
    reply = {**HELOC_GOOD, "rating": "strong", "recommendation": "Approve", "explanation": "Within the limit."}
    assert va.check_reply(reply, heloc_facts())["recommendation"] == "Approve"


def test_the_prompt_tells_the_agent_how_to_judge_a_heloc():
    prompt = va.build_prompt(heloc_facts())
    assert '"loan_type": "heloc"' in prompt and "combined_ltv_within_limit" in va.PROMPT and "HELOC" in va.PROMPT


def test_the_v1_prompt_is_kept_so_the_saved_runs_still_name_a_real_file():
    assert (va.PROMPT_PATH.parent / "valuation_agent_v1.md").exists()


# ---- running the step with a fake network ------------------------------------------------------------------------

class Net:
    """A fake network: answers each call in turn and records every request."""

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, url, headers, body, timeout):
        self.calls.append({"url": url, "body": json.loads(body)})
        status, content = self.replies.pop(0)
        if status != 200:
            return status, {"x-request-id": "req-err"}, json.dumps({"error": {"message": content}}).encode()
        text = content if isinstance(content, str) else json.dumps(content)
        return 200, {"x-request-id": f"req-{len(self.calls)}"}, json.dumps(
            {"choices": [{"message": {"content": text}}], "usage": {"prompt_tokens": 100, "completion_tokens": 30}}
        ).encode()


def run(net, agent=GROQ, f=None, sleeps=None, run_id="run-1", env=ENV):
    return va.run(f or facts(), agent=agent, run_id=run_id, transport=net, env=env, sleep=(sleeps.append if sleeps is not None else (lambda s: None)))


def test_a_good_reply_on_the_first_try_is_returned_and_logged_in_full(caplog):
    net = Net((200, GOOD))
    with caplog.at_level(logging.INFO, logger="al-ai.valuation-agent"):
        result = run(net)
    assert result.ok and result.reply == GOOD and result.failure_reason is None and len(net.calls) == 1
    a = result.attempts[0]
    assert a["run_id"] == "run-1" and a["attempt"] == 1 and a["provider"] == "groq" and a["model"] == "openai/gpt-oss-120b"
    assert a["prompt_version"] == "valuation-agent-v2" and a["outcome"] == "ok" and a["error"] is None
    assert a["raw_reply"] == json.dumps(GOOD) and a["parsed_reply"] == GOOD and a["request_id"] == "req-1" and a["duration_s"] >= 0
    assert a["input_tokens"] == 100 and a["output_tokens"] == 30
    assert json.loads(caplog.records[-1].getMessage())["request_id"] == "req-1"


def test_the_prompt_version_is_saved_with_every_attempt():
    result = run(Net((200, {**GOOD, "explanation": "It is 777."}), (200, GOOD)))
    assert [a["prompt_version"] for a in result.attempts] == ["valuation-agent-v2"] * 2


def test_a_bad_reply_is_retried_once_with_the_error_shown_to_the_model():
    net = Net((200, {**GOOD, "explanation": "The price is 777 euro too high."}), (200, GOOD))
    result = run(net)
    assert result.ok and len(net.calls) == 2
    assert [a["outcome"] for a in result.attempts] == ["invalid_reply", "ok"]
    first, second = (json.dumps(c["body"]) for c in net.calls)
    assert "rejected" not in first and "rejected" in second and "777" in second


def test_a_reply_that_is_not_json_is_a_bad_reply_and_keeps_its_raw_text_for_the_log():
    net = Net((200, "I think the price is fine."), (200, GOOD))
    result = run(net)
    assert result.ok and result.attempts[0]["outcome"] == "invalid_reply"
    assert result.attempts[0]["raw_reply"] == "I think the price is fine." and result.attempts[0]["request_id"] == "req-1"


def test_two_bad_replies_in_a_row_fail_the_step_with_the_reason_and_no_other_model_is_used():
    bad = {**GOOD, "explanation": "The price is 777 euro too high."}
    net = Net((200, bad), (200, bad))
    result = run(net)
    assert not result.ok and result.reply is None and "777" in result.failure_reason and len(net.calls) == 2
    assert all("groq.com" in c["url"] for c in net.calls)


def test_a_provider_error_is_retried_twice_with_backoff_and_then_the_step_fails():
    net = Net((500, "down"), (500, "down"), (500, "down"))
    sleeps = []
    result = run(net, sleeps=sleeps)
    assert not result.ok and len(net.calls) == 3 and sleeps == [1.0, 2.0]
    assert [a["outcome"] for a in result.attempts] == ["provider_error"] * 3 and "HTTP 500" in result.failure_reason
    assert all("groq.com" in c["url"] for c in net.calls)  # no other model


def test_a_provider_error_that_clears_is_recovered_from():
    net = Net((429, "slow down"), (200, GOOD))
    sleeps = []
    result = run(net, sleeps=sleeps)
    assert result.ok and sleeps == [1.0] and [a["outcome"] for a in result.attempts] == ["provider_error", "ok"]


def test_a_retry_after_a_provider_error_sends_the_same_prompt_again():
    net = Net((500, "down"), (200, GOOD))
    run(net)
    assert net.calls[0]["body"] == net.calls[1]["body"]


def test_a_bad_reply_and_a_provider_error_each_keep_their_own_retry_budget():
    bad = {**GOOD, "explanation": "The price is 777 euro too high."}
    net = Net((200, bad), (500, "down"), (500, "down"), (200, GOOD))
    sleeps = []
    result = run(net, sleeps=sleeps)
    assert result.ok and len(net.calls) == 4 and sleeps == [1.0, 2.0]
    assert "rejected" in json.dumps(net.calls[3]["body"])  # the repair prompt survives the outage


def test_a_missing_key_fails_at_once_and_makes_no_call():
    net = Net()
    result = run(net, env={})
    assert not result.ok and "GROQ_API_KEY" in result.failure_reason and net.calls == [] and result.attempts[0]["outcome"] == "missing_key"


def test_the_key_never_shows_up_in_the_attempts_or_the_log(caplog):
    net = Net((401, f"bad key {KEY}"))
    with caplog.at_level(logging.DEBUG):
        result = run(net, sleeps=[])
    assert KEY not in json.dumps(result.attempts) and KEY not in str(result.failure_reason) and KEY not in caplog.text


@pytest.mark.parametrize("agent,host", [(GROQ, "groq.com"), (MISTRAL, "mistral.ai")])
def test_switching_the_config_runs_the_same_step_with_the_same_checks(agent, host):
    net = Net((200, GOOD))
    result = run(net, agent=agent)
    assert result.ok and host in net.calls[0]["url"] and result.attempts[0]["model"] == agent.model
    bad = Net((200, {**GOOD, "recommendation": "Approve"}), (200, {**GOOD, "recommendation": "Approve"}))
    assert not run(bad, agent=agent).ok  # the same semantic check applies on either provider


def test_the_step_uses_the_valuation_agent_from_the_config_by_default():
    net = Net((200, GOOD))
    result = va.run(facts(), run_id="r", transport=net, env=ENV, sleep=lambda s: None)
    assert result.attempts[0]["provider"] == config.load().agent("valuation").provider


# ---- the new error type that carries a bad reply's raw text ------------------------------------------------------------

def test_the_client_tells_a_bad_reply_from_a_provider_error_and_keeps_the_raw_text():
    schema = {"type": "object", "properties": {"answer": {"type": "integer"}}, "required": ["answer"]}

    def bad_text(url, headers, body, timeout):
        return 200, {"x-request-id": "req-9"}, json.dumps({"choices": [{"message": {"content": "four"}}]}).encode()

    def wrong_shape(url, headers, body, timeout):
        return 200, {}, json.dumps({"choices": [{"message": {"content": '{"answer": "four"}'}}]}).encode()

    def down(url, headers, body, timeout):
        return 503, {}, b"{}"

    with pytest.raises(clients.InvalidReply) as err:
        clients.complete_json("groq", "m", "s", "u", schema, transport=bad_text, env=ENV)
    assert err.value.raw_reply == "four" and err.value.request_id == "req-9"
    with pytest.raises(clients.InvalidReply) as err:
        clients.complete_json("groq", "m", "s", "u", schema, transport=wrong_shape, env=ENV)
    assert err.value.raw_reply == '{"answer": "four"}'
    with pytest.raises(clients.LlmError) as err:
        clients.complete_json("groq", "m", "s", "u", schema, transport=down, env=ENV)
    assert not isinstance(err.value, clients.InvalidReply)


# ---- live: a real call on a made-up application, opt in --------------------------------------------------------------------

LIVE = pytest.mark.skipif(not os.getenv("AL_LIVE_LLM"), reason="live calls use free-tier requests: run with AL_LIVE_LLM=1")


@LIVE
def test_live_the_configured_valuation_agent_answers_a_made_up_application():
    from app.llm import smoke

    env = smoke.load_env()
    agent = config.load().agent("valuation")
    key = clients.PROVIDERS[agent.provider].key_name
    if key and not env.get(key):
        pytest.skip(f"{key} is not set")
    result = va.run(facts(), agent=agent, run_id="live-test", env=env)
    assert result.ok, result.failure_reason
    assert result.attempts[-1]["prompt_version"] == "valuation-agent-v2"


# ---- which provider errors are worth retrying -------------------------------------------------------------------------

@pytest.mark.parametrize("status", [401, 403, 404, 422])
def test_a_provider_error_that_retrying_cannot_fix_is_not_retried(status):
    net = Net((status, "no"))
    sleeps = []
    result = run(net, sleeps=sleeps)
    assert not result.ok and len(net.calls) == 1 and sleeps == [] and f"HTTP {status}" in result.failure_reason


@pytest.mark.parametrize("status", [408, 429, 500, 502, 503])
def test_a_provider_error_that_may_clear_is_retried(status):
    net = Net((status, "later"), (200, GOOD))
    assert run(net).ok and len(net.calls) == 2


def test_a_dead_network_is_retried_like_any_provider_error():
    calls = []

    def dead(url, headers, body, timeout):
        calls.append(1)
        raise OSError("connection refused")

    sleeps = []
    result = va.run(facts(), agent=GROQ, run_id="r", transport=dead, env=ENV, sleep=sleeps.append)
    assert not result.ok and len(calls) == 3 and sleeps == [1.0, 2.0]


# ---- digits inside text facts are not invented figures (found in review: "D24" and "C1" were rejected) ---------------------

def test_digits_in_the_eircode_area_and_the_ber_are_not_invented_figures():
    f = facts(routing_key="D24", ber="C1")
    reply = {**GOOD, "conditions": [], "explanation": "The home is in the D24 Eircode area. It has a C1 energy rating."}
    assert va.check_reply(reply, f)["explanation"] == reply["explanation"]


def test_a_figure_that_is_in_no_fact_is_still_rejected_next_to_those_digits():
    f = facts(routing_key="D24", ber="C1")
    with pytest.raises(va.ReplyRejected, match="25"):
        va.check_reply({**GOOD, "explanation": "The home is in the D25 Eircode area."}, f)


@pytest.mark.parametrize("area,ber", [("T12", "B"), ("D6W", "A2"), ("V94", "E1"), ("A65", "Unknown")])
def test_every_kind_of_eircode_area_and_ber_can_be_mentioned_by_name(area, ber):
    f = facts(routing_key=area, ber=ber)
    reply = {**GOOD, "conditions": [], "explanation": f"The home is in the {area} Eircode area and has BER {ber}."}
    assert va.check_reply(reply, f)["recommendation"] == "Conditionally Approve"


def test_the_demo_application_style_reply_survives_a_retry_free_run():
    f = facts(routing_key="D24", ber="C1")
    net = Net((200, {**GOOD, "conditions": [], "explanation": "The D24 home with a C1 rating is priced above the estimate."}))
    result = run(net, f=f)
    assert result.ok and len(net.calls) == 1
