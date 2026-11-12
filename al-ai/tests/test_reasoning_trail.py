"""The reasoning trail (AL-62): the committee record turned into the `ai_runs` fields SCHEMA.md names, with no Firestore.

The emulator tests in test_auto_start.py prove the same fields land on the `ai_runs` document.
"""

import test_committee as tc
from app import reasoning_trail, strategist_agent as sa

AGENT_FIELDS = {"provider", "model", "promptVersion", "report", "recommendation", "rating", "concerns", "conditions"}


def complete_record(**providers):
    record, _, _ = tc.go(tc.MORTGAGE, tc.Providers(**providers) if providers else None)
    assert record["status"] == "complete"
    return record


# ---- criterion 1: every agent's provider, model, vote, rating, concerns, conditions, report and prompt version ----

def test_every_agent_has_the_same_fields_under_the_schema_names():
    agents = reasoning_trail.fields(complete_record())["agents"]
    assert set(agents) == {"affordability", "valuation", "strategist", "market"}
    for name, agent in agents.items():
        assert set(agent) == AGENT_FIELDS, name


def test_each_agent_records_the_exact_provider_model_and_prompt_version_it_ran_with():
    record = complete_record()
    agents = reasoning_trail.fields(record)["agents"]
    steps = record["steps"]
    for name, step in (("affordability", "affordability"), ("valuation", "valuation_agent"), ("strategist", "strategist"), ("market", "market")):
        assert (agents[name]["provider"], agents[name]["model"], agents[name]["promptVersion"]) == (
            steps[step]["provider"], steps[step]["model"], steps[step]["prompt_version"],
        ), name
    assert agents["affordability"]["promptVersion"] == "affordability-agent-v1"
    assert agents["market"]["model"] == "gemini-3.1-flash-lite"


def test_the_affordability_agent_keeps_its_vote_rating_concerns_and_conditions():
    reply = {"rating": "weak", "recommendation": "Conditionally Approve", "concerns": ["Spare income is thin."], "conditions": ["Verify payslips."]}
    record = complete_record()
    record["steps"]["affordability"]["output"] = reply
    agent = reasoning_trail.fields(record)["agents"]["affordability"]
    assert (agent["recommendation"], agent["rating"], agent["concerns"], agent["conditions"]) == (
        "Conditionally Approve", "weak", ["Spare income is thin."], ["Verify payslips."],
    )
    assert "Spare income is thin." in agent["report"] and "Verify payslips." in agent["report"]


def test_the_affordability_report_is_text_even_with_no_concerns_or_conditions():
    agent = reasoning_trail.fields(complete_record())["agents"]["affordability"]
    assert agent["report"] == "Rating: adequate. Recommendation: Conditionally Approve.\nConcerns: none.\nConditions: none."


def test_the_valuation_agent_report_is_its_explanation_and_it_has_no_concerns():
    agent = reasoning_trail.fields(complete_record())["agents"]["valuation"]
    assert (agent["recommendation"], agent["rating"], agent["conditions"]) == ("Conditionally Approve", "adequate", [])
    assert agent["report"] == "The estimate supports the loan."
    assert agent["concerns"] is None  # its reply has no concerns field


def test_the_strategist_has_no_rating_and_no_concerns_and_its_report_is_the_memo():
    agent = reasoning_trail.fields(complete_record())["agents"]["strategist"]
    assert (agent["rating"], agent["concerns"]) == (None, None)
    assert agent["recommendation"] == "Approve" and agent["conditions"] == []
    assert agent["report"] == sa.render_memo(tc.strategist())


def test_market_and_macro_does_not_vote_and_its_report_is_the_summary():
    agent = reasoning_trail.fields(complete_record())["agents"]["market"]
    assert (agent["recommendation"], agent["rating"], agent["concerns"], agent["conditions"]) == (None, None, None, None)
    assert agent["report"] == "Rates look steady."


# ---- criterion 2: the strategist memo and the original and effective recommendation ----

def test_the_credit_memo_is_the_strategists_rendered_memo():
    assert reasoning_trail.fields(complete_record())["creditMemo"] == sa.render_memo(tc.strategist())


def test_the_original_and_effective_recommendations_come_from_the_policy_gate():
    record = complete_record()
    got = reasoning_trail.fields(record)
    assert (got["originalRecommendation"], got["effectiveRecommendation"]) == (record["original_recommendation"], record["effective_recommendation"])
    assert got["originalRecommendation"] == "Approve"


def test_a_policy_gate_downgrade_shows_as_a_different_effective_recommendation():
    over = {**tc.MORTGAGE, "loanAmountEur": 430_000, "grossIncomeEur": 500_000, "monthlyTakeHomeEur": 25_000}  # only the LTV cap broken (see test_committee)
    record, _, _ = tc.go(over)
    got = reasoning_trail.fields(record)
    assert (got["originalRecommendation"], got["effectiveRecommendation"]) == ("Approve", "Conditionally Approve")


# ---- criterion 3: the three votes side by side and a disagreement flag, no majority ----

def test_the_consensus_puts_the_three_votes_side_by_side():
    consensus = reasoning_trail.fields(complete_record())["consensus"]
    assert consensus == {
        "votes": {"affordability": "Conditionally Approve", "valuation": "Conditionally Approve", "strategist": "Approve"},
        "disagreement": True,
    }


def test_three_matching_votes_are_no_disagreement_and_market_is_never_a_vote():
    record = complete_record()
    record["steps"]["strategist"]["output"]["recommendation"] = "Conditionally Approve"
    consensus = reasoning_trail.fields(record)["consensus"]
    assert set(consensus) == {"votes", "disagreement"}  # no majority or overall verdict
    assert set(consensus["votes"]) == {"affordability", "valuation", "strategist"}
    assert consensus["disagreement"] is False


# ---- a run that did not finish keeps what it got, and nothing is made up ----

def test_a_failed_run_keeps_the_agents_that_finished_and_has_no_memo_votes_or_recommendation():
    record, _, _ = tc.go(tc.MORTGAGE, tc.Providers(ollama=(500, b"boom")))  # the affordability step fails
    assert record["status"] == "failed"
    got = reasoning_trail.fields(record)
    assert "affordability" not in got["agents"] and "strategist" not in got["agents"]
    assert set(got["agents"]) <= {"valuation", "market"} and "market" in got["agents"]
    assert (got["creditMemo"], got["originalRecommendation"], got["effectiveRecommendation"], got["consensus"]) == (None, None, None, None)


def test_a_record_with_no_steps_gives_empty_fields():
    got = reasoning_trail.fields({"run_id": "r", "status": "failed"})
    assert got == {"agents": {}, "creditMemo": None, "originalRecommendation": None, "effectiveRecommendation": None, "consensus": None}


def test_no_policy_gate_field_is_written_here():
    assert "policyGate" not in reasoning_trail.fields(complete_record())
