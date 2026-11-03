"""The strategist step: turns the three reports into a credit memo with fixed headings. Tested with a fake network.

A real run (Gemini, on real valuation and market reports) is the live test at the bottom: opt in with AL_LIVE_LLM=1.
"""

import json
import logging
import os
import re

import pytest

from app import strategist_agent as sa
from app.llm import config

GEMINI = config.AgentModel("gemini", "gemini-3.1-flash-lite")
KEY = "SECRET-KEY-do-not-leak-0123456789"
ENV = {"GEMINI_API_KEY": KEY}

LOAN = dict(loan_type="purchase", loan_eur=342_000.0, term_years=30, first_time_buyer=True, county="Cork", property_type="Semi-D", bedrooms=3, asking_price_eur=380_000.0)
AFFORDABILITY = {"rating": "adequate", "recommendation": "Approve", "concerns": ["Spare income is thin once rates rise 2 points."], "conditions": []}
VALUATION = {"rating": "weak", "recommendation": "Conditionally Approve", "conditions": ["Get an independent surveyor's valuation."],
             "explanation": "The model loan to value is 100.6 against the 90 limit."}
MARKET = {"outlook": "stable", "summary": "The ECB held its main rate at 2.15 and signalled a pause.",
          "sources": [{"url": "https://ecb.example/hold", "date": "Oct 23, 2026"}]}

MEMO = {
    "application_summary": "A 342000 euro purchase loan over 30 years for a Cork semi-detached house.",
    "affordability": "Affordability recommends Approve, with thin spare income once rates rise 2 points.",
    "property_assessment": "The valuation is weak: the model loan to value is 100.6 against the 90 limit.",
    "market_context": "Rates look stable after the ECB held its main rate at 2.15.",
    "disagreements": "Affordability recommends Approve but Valuation recommends Conditionally Approve. I side with Valuation because the loan to value is over the limit.",
    "recommendation_and_conditions": "Conditionally Approve, subject to an independent surveyor's valuation.",
}
GOOD = {"recommendation": "Conditionally Approve", "conditions": ["Get an independent surveyor's valuation."], "memo": MEMO}


def facts(**changes):
    parts = dict(loan=LOAN, affordability=AFFORDABILITY, valuation=VALUATION, market=MARKET)
    return sa.build_facts(**{**parts, **changes})


# ---- the prompt ------------------------------------------------------------------------------------

def test_the_prompt_is_a_versioned_file_with_the_five_parts_in_order():
    assert re.findall(r"^## (\w+)", sa.PROMPT, re.M) == ["Role", "Task", "Rules", "Data", "Output"]
    assert "{data}" in sa.PROMPT and sa.PROMPT_VERSION == "strategist-agent-v1" and sa.PROMPT_PATH.name == "strategist_agent_v1.md"


def test_the_prompt_names_every_memo_section():
    for key in sa.SECTIONS:
        assert key in sa.PROMPT


# ---- the facts: three reports and a loan summary, no personal data ----------------------------------------

def test_the_facts_hold_the_three_reports_and_the_loan_summary():
    f = facts()
    assert f["loan"]["loan_eur"] == 342_000.0 and f["affordability_report"]["recommendation"] == "Approve"
    assert f["valuation_report"]["rating"] == "weak" and f["market_report"]["outlook"] == "stable"


def test_the_market_report_is_passed_as_an_outlook_and_a_summary_without_links():
    f = facts()
    assert set(f["market_report"]) == {"outlook", "summary"} and "http" not in json.dumps(f)


def test_the_agents_that_disagree_are_worked_out_by_code():
    f = facts()
    assert f["voting_agents_disagree"] is True and f["votes"] == {"Affordability": "Approve", "Valuation": "Conditionally Approve"}
    agree = facts(valuation={**VALUATION, "recommendation": "Approve"})
    assert agree["voting_agents_disagree"] is False


@pytest.mark.parametrize("extra", [{"name": "Ada Byrne"}, {"email": "ada@example.ie"}, {"phone": "087 123 4567"}, {"eircode": "T12 AB34"}, {"address": "1 Main St"}])
def test_a_loan_summary_with_any_field_we_did_not_choose_is_refused(extra):
    with pytest.raises(ValueError, match="loan summary"):
        facts(loan={**LOAN, **extra})


@pytest.mark.parametrize("leak", ["Contact ada@example.ie for details.", "Call 087 123 4567 today.", "Lives at T12 AK34.", "Call +353 87 123 4567."])
def test_a_personal_identifier_inside_a_report_is_refused_before_it_reaches_the_prompt(leak):
    with pytest.raises(ValueError, match="personal"):
        facts(valuation={**VALUATION, "explanation": leak})


def test_no_personal_identifier_reaches_the_prompt():
    prompt = sa.build_prompt(facts())
    assert not re.search(r"@|\d{3} \d{3} \d{4}|\b[A-Z]\d{2} ?[0-9A-Z]{4}\b", prompt)
    assert "342000.0" in prompt


@pytest.mark.parametrize("bad", [{"recommendation": "Maybe"}, {"recommendation": None}])
def test_a_report_with_a_recommendation_we_do_not_know_is_refused(bad):
    with pytest.raises(ValueError):
        facts(affordability={**AFFORDABILITY, **bad})


def test_a_missing_report_is_refused():
    with pytest.raises(ValueError):
        facts(market=None)


# ---- checking a reply ---------------------------------------------------------------------------------------

def test_a_good_reply_passes():
    assert sa.check_reply(GOOD, facts()) == GOOD


@pytest.mark.parametrize("change", [
    {"recommendation": "Maybe"}, {"conditions": "one"}, {"conditions": [""]}, {"conditions": ["short."] * 6}, {"memo": "text"},
])
def test_a_reply_with_a_bad_field_is_rejected(change):
    with pytest.raises(sa.ReplyRejected):
        sa.check_reply({**GOOD, **change}, facts())


@pytest.mark.parametrize("reply", [{k: v for k, v in GOOD.items() if k != "memo"}, {**GOOD, "extra": 1}, []])
def test_a_reply_with_the_wrong_fields_is_rejected(reply):
    with pytest.raises(sa.ReplyRejected):
        sa.check_reply(reply, facts())


@pytest.mark.parametrize("section", sa.SECTIONS)
def test_every_memo_section_is_needed_and_must_be_text(section):
    missing = {k: v for k, v in MEMO.items() if k != section}
    with pytest.raises(sa.ReplyRejected, match=section):
        sa.check_reply({**GOOD, "memo": missing}, facts())
    with pytest.raises(sa.ReplyRejected, match=section):
        sa.check_reply({**GOOD, "memo": {**MEMO, section: ""}}, facts())


def test_an_extra_memo_section_is_rejected():
    with pytest.raises(sa.ReplyRejected):
        sa.check_reply({**GOOD, "memo": {**MEMO, "bonus": "x"}}, facts())


def test_a_memo_that_quotes_a_figure_it_was_not_given_is_rejected():
    with pytest.raises(sa.ReplyRejected, match="777"):
        sa.check_reply({**GOOD, "memo": {**MEMO, "market_context": "Rates will reach 777 percent."}}, facts())


def test_figures_from_the_reports_and_the_loan_are_allowed():
    assert sa.check_reply({**GOOD, "memo": {**MEMO, "property_assessment": "Loan to value 100.6 against the 90 limit on a loan of 342000."}}, facts())


def test_a_memo_with_a_link_is_rejected():
    with pytest.raises(sa.ReplyRejected, match="link"):
        sa.check_reply({**GOOD, "memo": {**MEMO, "market_context": "See https://evil.example/x for rates."}}, facts())


def test_when_the_voting_agents_disagree_the_disagreements_section_names_both():
    with pytest.raises(sa.ReplyRejected, match="Disagreements|disagreements"):
        sa.check_reply({**GOOD, "memo": {**MEMO, "disagreements": "None."}}, facts())
    with pytest.raises(sa.ReplyRejected, match="Valuation"):
        sa.check_reply({**GOOD, "memo": {**MEMO, "disagreements": "Affordability and the model differ."}}, facts())


def test_when_they_agree_the_disagreements_section_may_say_so():
    f = facts(valuation={**VALUATION, "recommendation": "Approve"})
    assert sa.check_reply({**GOOD, "memo": {**MEMO, "disagreements": "None. Both agents recommend Approve."}}, f)


# ---- the fixed headings ------------------------------------------------------------------------------------------

def test_the_memo_is_written_out_with_the_headings_from_the_ticket_in_order():
    text = sa.render_memo(GOOD)
    assert re.findall(r"^## (.+)$", text, re.M) == [
        "Application summary", "Affordability", "Property assessment", "Market context", "Disagreements", "Recommendation and conditions"]
    assert text == sa.render_memo(GOOD)  # the same input always gives the same text, so it can be hashed


# ---- running the step with a fake network ----------------------------------------------------------------------------

class Net:
    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, url, headers, body, timeout):
        self.calls.append(json.loads(body))
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(reply, tuple):
            return reply[0], {}, reply[1]
        text = reply if isinstance(reply, str) else json.dumps(reply)
        return 200, {}, json.dumps({"candidates": [{"content": {"parts": [{"text": text}]}}], "usageMetadata": {}, "responseId": "resp-1"}).encode()


def go(net, **kw):
    return sa.run(facts(), run_id="run-1", agent=GEMINI, transport=net, env=ENV, sleep=lambda s: None, **kw)


def test_a_run_asks_the_configured_strategist_model_once():
    net = Net(GOOD)
    r = go(net)
    assert r.ok and r.reply == GOOD and len(net.calls) == 1 and r.attempts[0]["prompt_version"] == "strategist-agent-v1"


def test_the_model_is_sent_the_facts_and_no_key():
    net = Net(GOOD)
    go(net)
    sent = json.dumps(net.calls[0])
    assert "Cork" in sent and "342000.0" in sent and KEY not in sent


def test_a_bad_reply_is_retried_once_with_the_reason_shown():
    net = Net({**GOOD, "recommendation": "Maybe"}, GOOD)
    r = go(net)
    assert r.ok and [a["outcome"] for a in r.attempts] == ["invalid_reply", "ok"]
    assert "Your previous reply was rejected" in json.dumps(net.calls[1])


def test_a_reply_that_hides_a_disagreement_is_retried_then_fails():
    hidden = {**GOOD, "memo": {**MEMO, "disagreements": "None."}}
    r = go(Net(hidden, hidden))
    assert r.ok is False and "disagreements" in r.failure_reason.lower()


def test_a_provider_outage_is_retried_with_a_pause_and_then_fails():
    pauses = []
    r = sa.run(facts(), run_id="r", agent=GEMINI, transport=Net((503, b"down")), env=ENV, sleep=pauses.append)
    assert r.ok is False and len(r.attempts) == 3 and pauses == [1.0, 2.0]


def test_a_wrong_key_is_not_retried_and_a_missing_key_sends_nothing():
    assert len(go(Net((403, b"bad"))).attempts) == 1
    net = Net(GOOD)
    r = sa.run(facts(), run_id="r", agent=GEMINI, transport=net, env={}, sleep=lambda s: None)
    assert r.attempts[0]["outcome"] == "missing_key" and net.calls == []


def test_every_attempt_is_logged_with_the_prompt_version_and_never_the_key(caplog):
    with caplog.at_level(logging.INFO, logger="al-ai.strategist-agent"):
        go(Net({**GOOD, "recommendation": "Maybe"}, GOOD))
    logged = [json.loads(r.message) for r in caplog.records]
    assert [a["outcome"] for a in logged] == ["invalid_reply", "ok"] and all(a["prompt_version"] == "strategist-agent-v1" for a in logged)
    assert logged[1]["request_id"] == "resp-1" and "duration_s" in logged[1] and KEY not in caplog.text


def test_the_agent_is_the_one_agents_json_names_for_the_strategist():
    assert config.load().agent("strategist") == GEMINI


# ---- live: a real call, opt in ---------------------------------------------------------------------------------------

LIVE = pytest.mark.skipif(not os.getenv("AL_LIVE_LLM"), reason="live calls use free-tier requests: run with AL_LIVE_LLM=1")


@LIVE
def test_live_the_configured_strategist_writes_a_checked_memo():
    from app.llm import smoke

    r = sa.run(facts(), run_id="live-test", env=smoke.load_env())
    assert r.ok, r.failure_reason
