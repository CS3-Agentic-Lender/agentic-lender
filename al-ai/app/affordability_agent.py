"""The affordability agent step: one call to the model agents.json names for it, checked before anyone trusts it.

Code owns the figures and the bands (affordability.py). The model only explains them and
recommends. Whatever it replies is checked against the schema and against the figures we
gave it. Retries and logging are the shared ones in app.agent_loop: a bad reply gets one retry with the error shown,
a provider error that may clear gets two retries with a pause, and then the step fails. There is no other provider
to fall back to. Every attempt is logged and returned.
"""

import json
import logging
import re
import time
from pathlib import Path
from typing import Callable

from app import affordability as aff
from app import agent_loop, retry_policy
from app import valuation_agent as va
from app.llm import clients, config

log = logging.getLogger("al-ai.affordability-agent")

PROMPT_VERSION = "affordability-agent-v1"
PROMPT = (Path(__file__).parent / "prompts" / "affordability_agent_v1.md").read_text()

SYSTEM = va.SYSTEM
RATINGS = ("strong", "adequate", "weak", "unaffordable")
RECOMMENDATIONS = ("Approve", "Conditionally Approve", "Decline")
SCHEMA = {
    "type": "object",
    "properties": {
        "rating": {"type": "string", "enum": list(RATINGS)},
        "recommendation": {"type": "string", "enum": list(RECOMMENDATIONS)},
        "concerns": {"type": "array", "items": {"type": "string"}},
        "conditions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["rating", "recommendation", "concerns", "conditions"],
    "additionalProperties": False,
}
MAX_ITEMS = 5
MAX_SENTENCE = 300
# Figures from our own policy that the prompt and the bands mention, so a reply may quote them.
POLICY_NUMBERS = {0.0, 2.0, 3.5, 4.0, 40.0, 50.0, 500.0}

ReplyRejected = va.ReplyRejected


def build_facts(
    *,
    loan: float,
    years: float,
    benchmark_rate: float,
    gross_annual_income: float,
    net_monthly_income: float,
    monthly_debts: float,
    monthly_living_costs: float,
    first_time_buyer: bool,
) -> dict:
    """The only figures the agent sees. Code works them all out; the model quotes them."""
    a = aff.assess(loan, years, benchmark_rate, gross_annual_income, net_monthly_income, monthly_debts, monthly_living_costs)
    return {
        "loan_eur": round(loan, 2),
        "term_years": years,
        "benchmark_rate_pct": round(benchmark_rate * 100, 2),
        "stress_margin_pct": round(aff.STRESS_MARGIN * 100, 2),
        "first_time_buyer": first_time_buyer,
        "gross_annual_income_eur": round(gross_annual_income, 2),
        "net_monthly_income_eur": round(net_monthly_income, 2),
        "monthly_debts_eur": round(monthly_debts, 2),
        "monthly_living_costs_eur": round(monthly_living_costs, 2),
        "repayment_eur": round(a.repayment, 2),
        "stressed_repayment_eur": round(a.stressed_repayment, 2),
        "loan_to_income": round(a.loan_to_income, 2),
        "lti_cap": aff.LTI_CAP_FIRST_TIME if first_time_buyer else aff.LTI_CAP_OTHER,
        "lti_cap_breached": aff.exceeds_lti_cap(loan, gross_annual_income, first_time_buyer),
        "dti_pct": round(a.dti * 100, 2),
        "stressed_dti_pct": round(a.stressed_dti * 100, 2),
        "surplus_eur": round(a.surplus, 2),
        "stressed_surplus_eur": round(a.stressed_surplus, 2),
        "dti_band": a.dti_band,
        "surplus_band": a.surplus_band,
    }


def build_prompt(facts: dict) -> str:
    return PROMPT.replace("{data}", json.dumps(facts, indent=2))


def _numbers(text: str) -> list[float]:
    return [float(n.replace(",", "")) for n in re.findall(r"\d+(?:,\d{3})*(?:\.\d+)?", text)]


def _allowed_numbers(facts: dict) -> set[float]:
    allowed = set(POLICY_NUMBERS)
    for v in facts.values():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            # _numbers() drops the sign ("-1439.61" and "short by 1,439.61" both read as 1439.61), so compare sizes
            allowed |= {abs(float(v)), round(abs(v), 0), round(abs(v), 1)}
    return allowed


def check_reply(reply, facts: dict) -> dict:
    """Check a parsed reply. Raises ReplyRejected with a message the model can act on."""
    if not isinstance(reply, dict):
        raise ReplyRejected("the reply must be one JSON object")
    if set(reply) != {"rating", "recommendation", "concerns", "conditions"}:
        raise ReplyRejected('the fields must be exactly "rating", "recommendation", "concerns" and "conditions"')
    if not isinstance(reply["rating"], str) or reply["rating"] not in RATINGS:
        raise ReplyRejected(f'"rating" must be one of {list(RATINGS)}')
    if not isinstance(reply["recommendation"], str) or reply["recommendation"] not in RECOMMENDATIONS:
        raise ReplyRejected(f'"recommendation" must be one of {list(RECOMMENDATIONS)}')
    allowed = _allowed_numbers(facts)
    for name in ("concerns", "conditions"):
        items = reply[name]
        if not isinstance(items, list) or len(items) > MAX_ITEMS:
            raise ReplyRejected(f'"{name}" must be a list of at most {MAX_ITEMS} sentences')
        for item in items:
            if not isinstance(item, str) or not item.strip() or len(item) > MAX_SENTENCE:
                raise ReplyRejected(f'every item in "{name}" must be a short, non-empty sentence')
            for n in _numbers(item):
                if n not in allowed:
                    raise ReplyRejected(f'"{item}" quotes {n:g}, which is not in DATA')
    # Code decides what a cap breach or an Adverse band means. The reply cannot clear it.
    blocked = facts["lti_cap_breached"] or "Adverse" in (facts["dti_band"], facts["surplus_band"])
    if blocked and reply["recommendation"] == "Approve":
        raise ReplyRejected("you cannot recommend Approve when a band is Adverse or the loan-to-income cap is breached")
    return reply


def run(
    facts: dict,
    *,
    run_id: str,
    agent: config.AgentModel | None = None,
    transport: clients.Transport = clients.urllib_transport,
    env: dict | None = None,
    sleep: Callable[[float], None] = time.sleep,
    budget: retry_policy.Budget | None = None,
    context: dict | None = None,
    record: Callable[[dict, dict], None] | None = None,
) -> va.AgentResult:
    """Run the step with the model agents.json names for the affordability agent. Never calls any other model."""
    agent = agent or config.load().agent("affordability")
    return agent_loop.run_step(
        log=log, agent=agent, prompt=build_prompt(facts), system=SYSTEM, schema=SCHEMA, check=lambda reply: check_reply(reply, facts),
        run_id=run_id, prompt_version=PROMPT_VERSION, transport=transport, env=env, sleep=sleep, budget=budget, context=context, record=record,
    )


def main(argv: list[str]) -> int:
    """A real run: cd al-ai && uv run python -m app.affordability_agent (needs Ollama running with the model agents.json names)."""
    import uuid

    from app.llm import smoke

    # Reference case from AL-115: joint mover, EUR 270,000 over 25 years, at a 4.00% test rate.
    demo = build_facts(
        loan=270_000, years=25, benchmark_rate=0.04, gross_annual_income=90_000,
        net_monthly_income=5_600, monthly_debts=300, monthly_living_costs=2_400, first_time_buyer=False,
    )
    result = run(demo, run_id=str(uuid.uuid4()), env=smoke.load_env())
    print(json.dumps({"ok": result.ok, "reply": result.reply, "failure_reason": result.failure_reason}, indent=2))
    return 0 if result.ok else 1


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    sys.exit(main(sys.argv[1:]))
