"""The committee flow (AL-138): the nodes run in the ticket's order, the state holds every step's result, and a failed step
still leaves a record. All tested with fake providers: no network, no keys.

The real run through Gemini, Groq and Ollama is the evidence in docs/committee-run-evidence.json (see the PR).
"""

import copy
import json
from pathlib import Path

import pytest

from datetime import UTC, datetime

from app import committee, committee_input, official_rates, policy_gate, rates, valuation_endpoint, valuation_model
from app import market_agent as ma
from app.llm import config

SAMPLES = Path(__file__).resolve().parents[1] / "app" / "committee_samples"
MORTGAGE = json.loads((SAMPLES / "mortgage-application.json").read_text())
HELOC = json.loads((SAMPLES / "heloc-application.json").read_text())

AGENTS = {
    "affordability": config.AgentModel("ollama", "qwen3.5:9b"),
    "valuation": config.AgentModel("groq", "openai/gpt-oss-120b"),
    "strategist": config.AgentModel("gemini", "gemini-3.1-flash-lite"),
    "market": config.AgentModel("gemini", "gemini-3.1-flash-lite"),
}
ENV = {"GROQ_API_KEY": "k", "GEMINI_API_KEY": "k", "OLLAMA_HOST": "http://ollama.test:11434"}
TODAY = "2026-10-23"
FETCHED = datetime(2026, 10, 23, 8, 0, tzinfo=UTC)
RATES = {  # the 4.00% test rate the reference cases use, dated
    "mortgage_ie": rates.Rate("mortgage_ie", 4.0, "2026-09", 4.5, "2025-09", FETCHED),
    "ecb_mrr": rates.Rate("ecb_mrr", 2.15, "2026-06-11", 3.65, "2025-06-11", FETCHED),
}


def get_rate(name):
    return RATES[name]


OFFICIAL = official_rates.load(get_rate, TODAY).official  # what the market step builds from those rates

AFFORDABILITY = {"rating": "adequate", "recommendation": "Conditionally Approve", "concerns": [], "conditions": []}
VALUATION = {"rating": "adequate", "recommendation": "Conditionally Approve", "conditions": [], "explanation": "The estimate supports the loan."}
MEMO = {
    "application_summary": "A loan for a Dublin semi-detached house.",
    "affordability": "Affordability recommends Conditionally Approve.",
    "property_assessment": "Valuation recommends Conditionally Approve.",
    "market_context": "Rates look stable.",
    "disagreements": "None. Both agents recommend Conditionally Approve.",
    "recommendation_and_conditions": "Approve.",
}


def strategist(recommendation="Approve"):
    return {"recommendation": recommendation, "conditions": [], "memo": MEMO}


class Providers:
    """Fake Ollama, Groq and Gemini on one fake network. Each gets the replies we give it in order (the last one repeats)."""

    def __init__(self, ollama=AFFORDABILITY, groq=VALUATION, gemini=None):
        self.replies = {"ollama.test": [ollama], "api.groq.com": [groq], "generativelanguage": [gemini or strategist()]}
        self.calls = []  # (provider host, request body)

    def __call__(self, url, headers, body, timeout):
        host = next(h for h in self.replies if h in url)
        self.calls.append((host, json.loads(body)))
        queue = self.replies[host]
        got = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(got, tuple):
            return got[0], {}, got[1]
        text = json.dumps(got)
        if host == "ollama.test":
            payload = {"message": {"content": text}}
        elif host == "api.groq.com":
            payload = {"choices": [{"message": {"content": text}}]}
        else:
            payload = {"candidates": [{"content": {"parts": [{"text": text}]}}], "usageMetadata": {}, "responseId": "resp-1"}
        return 200, {}, json.dumps(payload).encode()

    def hosts(self):
        return [host for host, _ in self.calls]


class MemoryRunStore:
    def __init__(self):
        self.saved = []

    def save(self, record):
        self.saved.append(record)


def a_report_for_today():
    """The day's market report, already made, so the market step reuses it and calls no model or search (that step has its own tests)."""
    store = ma.MemoryReportStore()
    store.put(ma.report_key(OFFICIAL, TODAY), {
        "report_id": "market-test", "date": TODAY, "official_figures_fingerprint": OFFICIAL.fingerprint(),
        "prompt_version": ma.PROMPT_VERSION, "provider": "gemini", "model": "gemini-3.1-flash-lite", "run_id": "earlier",
        "outlook": "stable", "summary": "Rates look steady.", "sources": [{"url": "https://ecb.example/hold", "date": "Oct 23, 2026"}],
    })
    return store


def go(application, providers=None, store=None):
    providers = providers or Providers()
    store = store or MemoryRunStore()
    deps = committee.Deps(
        store=store, report_store=a_report_for_today(), get_rate=get_rate, today=TODAY,
        agents=AGENTS, transport=providers, env=ENV, sleep=lambda s: None,
        search=lambda *a, **k: pytest.fail("the day's report exists, so no search should run"),
    )
    return committee.run_committee(application, deps=deps, application_id="app-1"), providers, store


# ---- criterion 3: the node order, and the state holds each step's result ------------------------

def test_the_nodes_run_in_the_ticket_order_with_the_two_agents_side_by_side():
    record, _, _ = go(MORTGAGE)
    order = record["node_order"]
    assert order[:4] == ["validate", "valuation_model", "market", "calculations"]
    assert set(order[4:6]) == {"affordability", "valuation_agent"}  # side by side: either may finish first
    assert order[6:] == ["strategist", "policy_gate", "save"]


def test_the_run_state_holds_every_steps_result():
    record, _, _ = go(MORTGAGE)
    assert record["status"] == "complete" and record["failed_step"] is None
    assert list(record["steps"]) and set(record["steps"]) == {
        "validate", "valuation_model", "market", "calculations", "affordability", "valuation_agent", "strategist", "policy_gate"}
    assert all(step["ok"] for step in record["steps"].values())
    assert record["steps"]["valuation_model"]["output"]["estimate_eur"] > 0
    assert record["steps"]["affordability"]["output"] == AFFORDABILITY
    assert record["steps"]["strategist"]["output"]["recommendation"] == "Approve"
    assert record["steps"]["strategist"]["memo"].startswith("## Application summary")


def test_each_agent_calls_the_provider_agents_json_gives_it():
    record, providers, _ = go(MORTGAGE)
    assert sorted(providers.hosts()) == ["api.groq.com", "generativelanguage", "ollama.test"]  # market reused its report: no call
    for name, provider in (("affordability", "ollama"), ("valuation_agent", "groq"), ("strategist", "gemini")):
        assert record["steps"][name]["provider"] == provider and record["steps"][name]["prompt_version"]


def test_the_strategist_is_given_both_agents_reports():
    _, providers, _ = go(MORTGAGE)
    sent = json.dumps(next(body for host, body in providers.calls if host == "generativelanguage"))
    assert "Conditionally Approve" in sent and "Rates look steady" in sent


# ---- criterion 2: one record per run, with the fields from the ticket --------------------------

def test_a_run_saves_one_record_with_a_unique_run_id_and_the_fields_from_the_ticket():
    first, _, store = go(MORTGAGE)
    second, _, _ = go(MORTGAGE)
    assert store.saved == [first] and first["run_id"] != second["run_id"]
    for key in ("run_id", "application_id", "rerun_of", "status", "started_at", "finished_at", "failed_step", "failure_reason",
                "steps", "original_recommendation", "effective_recommendation", "ai_calls", "node_order"):
        assert key in first
    assert first["application_id"] == "app-1" and first["rerun_of"] is None
    assert first["original_recommendation"] == "Approve" and first["effective_recommendation"] == "Approve"


def test_the_record_lists_a_call_id_for_every_logged_attempt():
    record, _, _ = go(MORTGAGE)
    assert [c["step"] for c in record["ai_calls"]] and {c["step"] for c in record["ai_calls"]} == {"affordability", "valuation_agent", "strategist"}
    assert all(c["id"].startswith(record["run_id"]) for c in record["ai_calls"])


def test_the_record_can_be_written_as_json_and_kept_in_a_file(tmp_path):
    record, _, _ = go(MORTGAGE)
    store = committee.JsonFileRunStore(tmp_path / "runs")
    store.save(record)
    assert json.loads(store.path_for(record["run_id"]).read_text()) == json.loads(json.dumps(record))


# ---- a failed step still leaves a record (decision 3) -------------------------------------------

def test_a_step_that_fails_after_its_retries_saves_a_failed_run_with_no_recommendation():
    record, providers, store = go(MORTGAGE, Providers(ollama=(503, b"down")))
    assert record["status"] == "failed" and record["failed_step"] == "affordability"
    assert "strategist" not in record["steps"] and "policy_gate" not in record["steps"]
    assert record["original_recommendation"] is None and record["effective_recommendation"] is None
    assert record["steps"]["valuation_agent"]["ok"] is True  # the partial evidence is kept
    assert len(record["steps"]["affordability"]["attempts"]) == 3 and record["steps"]["affordability"]["ok"] is False
    assert "generativelanguage" not in providers.hosts() and store.saved == [record]


def test_an_invalid_application_fails_at_validate_before_any_model_is_called():
    bad = copy.deepcopy(MORTGAGE)
    del bad["property"]["askingPriceEur"]
    record, providers, _ = go(bad)
    assert record["status"] == "failed" and record["failed_step"] == "validate" and providers.calls == []
    assert "askingPriceEur" in record["failure_reason"] and "D24" not in json.dumps(record)  # no Eircode in the record


def test_an_unknown_county_fails_at_validate():
    bad = copy.deepcopy(MORTGAGE)
    bad["property"]["county"] = "Atlantis"
    record, providers, _ = go(bad)
    assert record["failed_step"] == "validate" and "county" in record["failure_reason"] and providers.calls == []


def test_a_valuation_model_that_is_unavailable_fails_that_step(monkeypatch):
    def unavailable(request):
        raise valuation_model.ValuationUnavailable("the model file is missing")

    monkeypatch.setattr(valuation_endpoint, "estimate_home", unavailable)
    record, providers, _ = go(MORTGAGE)
    assert record["failed_step"] == "valuation_model" and "missing" in record["failure_reason"] and providers.calls == []


def test_a_reply_the_strategist_cannot_use_fails_the_run_after_its_retry():
    record, _, _ = go(MORTGAGE, Providers(gemini={"recommendation": "Maybe", "conditions": [], "memo": MEMO}))
    assert record["failed_step"] == "strategist" and record["status"] == "failed" and len(record["steps"]["strategist"]["attempts"]) == 2


def test_an_error_nobody_planned_for_still_saves_a_failed_record(monkeypatch):
    def broken(request):
        raise KeyError("something odd")

    monkeypatch.setattr(valuation_endpoint, "estimate_home", broken)
    record, providers, store = go(MORTGAGE)
    assert record["status"] == "failed" and record["failed_step"] == "valuation_model"
    assert record["failure_reason"].startswith("unexpected error: KeyError") and providers.calls == [] and store.saved == [record]


def test_when_both_side_by_side_agents_fail_the_earlier_step_in_the_flow_is_the_one_reported():
    for _ in range(5):  # either may finish first; the report must not depend on that
        record, _, _ = go(MORTGAGE, Providers(ollama=(503, b"down"), groq=(503, b"down")))
        assert record["failed_step"] == "affordability" and record["steps"]["valuation_agent"]["ok"] is False


# ---- the policy gate, on a mortgage ----------------------------------------------------------------

def test_a_mortgage_over_the_ltv_limit_gets_an_exception_condition_and_the_approve_becomes_conditional():
    over = copy.deepcopy(MORTGAGE)
    over["loanAmountEur"] = 430_000  # 95.6% of the asking price
    over["grossIncomeEur"] = 500_000  # high, so the income cap is not broken and only the LTV cap is
    over["monthlyTakeHomeEur"] = 25_000
    record, _, _ = go(over)
    gate = record["steps"]["policy_gate"]["output"]
    assert gate["breaches"] == [policy_gate.LTV_CAP] and gate["original"] == "Approve" and gate["effective"] == "Conditionally Approve"
    assert f"{policy_gate.EXCEPTION_CONDITION} ({policy_gate.LTV_CAP})" in gate["conditions"] and gate["changed"] is True
    assert record["effective_recommendation"] == "Conditionally Approve"


# ---- criterion 5: a HELOC, below and above the 80% cap -------------------------------------------

def heloc_with_balance_of(share_of_value: float, income=HELOC["grossIncomeEur"]):
    """A HELOC whose existing balance is a share of the model's estimate for the home, so the combined LTV is easy to set."""
    application = copy.deepcopy(HELOC)
    request = committee_input.Application.model_validate(application).valuation_request()
    estimate = valuation_endpoint.estimate_home(request)[0].estimate_eur
    application["existingMortgageBalanceEur"] = round(estimate * share_of_value - application["loanAmountEur"])
    application["grossIncomeEur"] = income
    return application


def test_a_heloc_below_the_80_percent_cap_runs_through_with_combined_ltv_and_the_surveyor_condition():
    record, providers, _ = go(heloc_with_balance_of(0.5))
    assert record["status"] == "complete"
    facts = record["steps"]["calculations"]["output"]["valuation_facts"]
    assert facts["loan_type"] == "heloc" and facts["combined_ltv_pct"] == pytest.approx(50, abs=0.1) and facts["combined_ltv_within_limit"] is True
    sent = json.dumps(next(body for host, body in providers.calls if host == "api.groq.com"))
    assert "combined_ltv_pct" in sent  # the valuation agent was given combined LTV
    gate = record["steps"]["policy_gate"]["output"]
    assert gate["breaches"] == [] and gate["effective"] == "Conditionally Approve"
    assert policy_gate.SURVEYOR_CONDITION in gate["conditions"] and policy_gate.CLTV_CAP not in " ".join(gate["conditions"])


def test_a_heloc_above_the_80_percent_cap_gets_cltv_cap_and_the_surveyor_condition():
    record, _, _ = go(heloc_with_balance_of(0.9, income=2_000_000))  # the income is high so only the value cap is broken
    facts = record["steps"]["calculations"]["output"]["valuation_facts"]
    assert facts["combined_ltv_pct"] == pytest.approx(90, abs=0.1) and facts["combined_ltv_within_limit"] is False
    gate = record["steps"]["policy_gate"]["output"]
    assert gate["breaches"] == [policy_gate.CLTV_CAP]
    assert f"{policy_gate.EXCEPTION_CONDITION} ({policy_gate.CLTV_CAP})" in gate["conditions"] and policy_gate.SURVEYOR_CONDITION in gate["conditions"]
    assert gate["original"] == "Approve" and gate["effective"] == "Conditionally Approve" and gate["changed"] is True
