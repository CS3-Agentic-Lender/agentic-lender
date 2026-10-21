"""The affordability agent step: one call to the local Ollama model, checked before anyone trusts it.

Code owns the figures and the bands (affordability.py). The model only explains them and
recommends. Whatever it replies is checked against the schema and against the figures we
gave it. A bad reply gets one retry with the error shown, then the step fails: there is no
other provider to fall back to. Every attempt is logged and returned.
"""

import http.client
import json
import logging
import re
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable

from app import affordability as aff

log = logging.getLogger("al-ai.affordability-agent")

PROMPT_VERSION = "affordability-agent-v1"
PROMPT = (Path(__file__).parent / "prompts" / "affordability_agent_v1.md").read_text()

RATINGS = {"strong", "adequate", "weak", "unaffordable"}
RECOMMENDATIONS = {"Approve", "Conditionally Approve", "Decline"}
MAX_ITEMS = 5
MAX_SENTENCE = 300
# Figures from our own policy that the prompt and the bands mention, so a reply may quote them.
POLICY_NUMBERS = {0.0, 2.0, 3.5, 4.0, 40.0, 50.0, 500.0}

OLLAMA_URL = "http://localhost:11434"
TIMEOUT_S = 120


# What a failed Ollama call raises: no connection or a timeout (OSError, which covers URLError), a cut-off
# response, a body that isn't JSON, or JSON without "response". Anything else is a bug in our code and must show.
PROVIDER_ERRORS = (OSError, http.client.HTTPException, json.JSONDecodeError, KeyError)


class InvalidReply(ValueError):
    """The model replied, but not with something we accept."""


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


def validate(raw: str, facts: dict) -> dict:
    """Parse the reply and check it. Raises InvalidReply with a message the model can act on."""
    text = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    try:
        reply = json.loads(text)
    except json.JSONDecodeError as e:
        raise InvalidReply(f"the reply is not valid JSON ({e.msg})") from e
    if not isinstance(reply, dict):
        raise InvalidReply("the reply must be one JSON object")
    if set(reply) != {"rating", "recommendation", "concerns", "conditions"}:
        raise InvalidReply('the fields must be exactly "rating", "recommendation", "concerns" and "conditions"')
    if not isinstance(reply["rating"], str) or reply["rating"] not in RATINGS:
        raise InvalidReply(f'"rating" must be one of {sorted(RATINGS)}')
    if not isinstance(reply["recommendation"], str) or reply["recommendation"] not in RECOMMENDATIONS:
        raise InvalidReply(f'"recommendation" must be one of {sorted(RECOMMENDATIONS)}')
    allowed = _allowed_numbers(facts)
    for name in ("concerns", "conditions"):
        items = reply[name]
        if not isinstance(items, list) or len(items) > MAX_ITEMS:
            raise InvalidReply(f'"{name}" must be a list of at most {MAX_ITEMS} sentences')
        for item in items:
            if not isinstance(item, str) or not item.strip() or len(item) > MAX_SENTENCE:
                raise InvalidReply(f'every item in "{name}" must be a short, non-empty sentence')
            for n in _numbers(item):
                if n not in allowed:
                    raise InvalidReply(f'"{item}" quotes {n:g}, which is not in DATA')
    # Code decides what a cap breach or an Adverse band means. The reply cannot clear it.
    blocked = facts["lti_cap_breached"] or "Adverse" in (facts["dti_band"], facts["surplus_band"])
    if blocked and reply["recommendation"] == "Approve":
        raise InvalidReply("you cannot recommend Approve when a band is Adverse or the loan-to-income cap is breached")
    return reply


def ollama_call(model: str, base_url: str = OLLAMA_URL) -> Callable[[str], str]:
    """A function that sends one prompt to the local Ollama model and returns its reply text."""

    def call(prompt: str) -> str:
        body = json.dumps(
            {"model": model, "prompt": prompt, "stream": False, "format": "json", "options": {"temperature": 0.2}}
        ).encode()
        req = urllib.request.Request(f"{base_url}/api/generate", body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            return json.load(resp)["response"]

    return call


@dataclass
class AgentResult:
    ok: bool
    reply: dict | None
    failure_reason: str | None
    attempts: list[dict] = field(default_factory=list)


def run(facts: dict, call: Callable[[str], str], *, model: str, run_id: str) -> AgentResult:
    """One attempt, then one repair attempt if the reply is rejected. Never calls anything else."""
    prompt = build_prompt(facts)
    attempts: list[dict] = []
    error = None
    for n in (1, 2):
        sent = prompt if error is None else (
            f"{prompt}\n\nYour previous reply was rejected: {error}. Reply again with only the corrected JSON object."
        )
        started = datetime.now(UTC)
        t0 = time.monotonic()
        attempt = {
            "run_id": run_id, "attempt": n, "provider": "ollama", "model": model,
            "prompt_version": PROMPT_VERSION, "started_at": started.isoformat(),
            "raw_reply": None, "parsed_reply": None, "outcome": None, "error": None,
        }
        try:
            attempt["raw_reply"] = call(sent)
            attempt["parsed_reply"] = validate(attempt["raw_reply"], facts)
            attempt["outcome"] = "ok"
        except InvalidReply as e:
            attempt["outcome"], attempt["error"] = "invalid_reply", str(e)
        except PROVIDER_ERRORS as e:  # provider down, timeout, bad HTTP: retrying the same call won't repair it
            attempt["outcome"], attempt["error"] = "provider_error", f"{type(e).__name__}: {e}"
        attempt["duration_s"] = round(time.monotonic() - t0, 3)
        attempts.append(attempt)
        log.info(json.dumps(attempt))
        if attempt["outcome"] == "ok":
            return AgentResult(True, attempt["parsed_reply"], None, attempts)
        if attempt["outcome"] == "provider_error":
            break
        error = attempt["error"]
    return AgentResult(False, None, attempts[-1]["error"], attempts)


if __name__ == "__main__":  # real run for the evidence: uv run python -m app.affordability_agent MODEL
    import sys
    import uuid

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    model = sys.argv[1]
    # Reference case from AL-115: joint mover, EUR 270,000 over 25 years, at a 4.00% test rate.
    demo = build_facts(
        loan=270_000, years=25, benchmark_rate=0.04, gross_annual_income=90_000,
        net_monthly_income=5_600, monthly_debts=300, monthly_living_costs=2_400, first_time_buyer=False,
    )
    result = run(demo, ollama_call(model), model=model, run_id=str(uuid.uuid4()))
    print(json.dumps({"ok": result.ok, "reply": result.reply, "failure_reason": result.failure_reason}, indent=2))
