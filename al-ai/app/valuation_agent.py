"""The valuation agent step: one committee step that explains numbers our own code already worked out.

Code works out the price gap, the "price needs review" flag and both loan to value figures (app.valuation_checks). The
model only explains whether the price is in line and how sure the estimate is, and may suggest a condition. Whatever it
replies is checked against the schema and against the figures we gave it, and it can never clear a flag the code set.

A bad reply gets one retry with the error shown. A provider error that may clear (a timeout or an outage or a rate
limit) gets up to two retries with a pause. After that the step fails with the reason. There is no other model to fall
back to: moving the step to another provider is an edit to agents.json made by a person. Every attempt is logged.
"""

import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable

from app import valuation_checks
from app.llm import clients, config

log = logging.getLogger("al-ai.valuation-agent")

PROMPT_VERSION = "valuation-agent-v1"
PROMPT_PATH = Path(__file__).parent / "prompts" / "valuation_agent_v1.md"
PROMPT = PROMPT_PATH.read_text()

SYSTEM = "You are a careful analyst. You reply only with one JSON object that matches the schema."
RATINGS = ("strong", "adequate", "weak", "unsupported")
RECOMMENDATIONS = ("Approve", "Conditionally Approve", "Decline")
SCHEMA = {
    "type": "object",
    "properties": {
        "rating": {"type": "string", "enum": list(RATINGS)},
        "recommendation": {"type": "string", "enum": list(RECOMMENDATIONS)},
        "conditions": {"type": "array", "items": {"type": "string"}},
        "explanation": {"type": "string"},
    },
    "required": ["rating", "recommendation", "conditions", "explanation"],
    "additionalProperties": False,
}
MAX_ITEMS = 5
MAX_SENTENCE = 300
MAX_EXPLANATION = 900
# Figures that are not in DATA but are ours to say: the basis reads "2024 asking-price estimate".
POLICY_NUMBERS = {2024.0}
INVALID_REPLY_RETRIES = 1
PROVIDER_RETRIES = 2
BACKOFF_S = (1.0, 2.0)
RETRYABLE_CLIENT_ERRORS = {408, 429}  # any other 4xx (a wrong key, a bad request) will not be fixed by asking again


class ReplyRejected(ValueError):
    """The model replied, but not with something we accept. The message is shown to the model on the retry."""


def build_facts(
    *,
    county: str,
    property_type: str,
    bedrooms: int,
    floor_area_m2: float,
    ber: str,
    routing_key: str,
    asking_price_eur: float | None,
    loan_eur: float,
    estimate_eur: float,
    review_threshold: float,
    support_warnings: tuple[str, ...] = (),
) -> dict:
    """The only figures the agent sees. Code works them all out and the model quotes them. No name or full Eircode goes in."""
    c = valuation_checks.check_valuation(
        estimate=estimate_eur, loan=loan_eur, asking_price=asking_price_eur,
        review_threshold=review_threshold, support_warnings=tuple(support_warnings),
    )
    pct = lambda x: None if x is None else round(x * 100, 2)  # noqa: E731
    return {
        "county": county, "property_type": property_type, "bedrooms": bedrooms, "floor_area_m2": floor_area_m2, "ber": ber,
        "eircode_area": routing_key,
        "estimate_basis": "2024 asking-price estimate",
        "estimate_eur": round(estimate_eur, 2),
        "asking_price_eur": None if asking_price_eur is None else round(asking_price_eur, 2),
        "loan_eur": round(loan_eur, 2),
        "price_gap_pct": pct(c.price_gap),
        "review_threshold_pct": pct(review_threshold),
        "price_needs_review": c.needs_review,
        "purchase_ltv_pct": pct(c.purchase_ltv),
        "purchase_ltv_within_limit": c.purchase_ltv_within_limit,
        "model_ltv_pct": pct(c.model_ltv),
        "model_ltv_within_limit": c.model_ltv_within_limit,
        "ltv_limit_pct": round(valuation_checks.LTV_LIMIT * 100, 2),
        "support_warnings": list(c.support_warnings),
    }


def build_prompt(facts: dict) -> str:
    return PROMPT.replace("{data}", json.dumps(facts, indent=2))


def _numbers(text: str) -> list[float]:
    return [float(n.replace(",", "")) for n in re.findall(r"\d+(?:,\d{3})*(?:\.\d+)?", text)]


def _allowed_numbers(facts: dict) -> set[float]:
    allowed = set(POLICY_NUMBERS)
    for value in facts.values():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            # _numbers() drops the sign, so compare sizes. A rounded form is fine too ("100.6" for 100.59).
            allowed |= {abs(float(value)), round(abs(value), 0), round(abs(value), 1)}
    for text in [facts["estimate_basis"], *facts["support_warnings"]]:
        allowed |= set(_numbers(text))
    return allowed


def check_reply(reply, facts: dict) -> dict:
    """Check a parsed reply. Raises ReplyRejected with a message the model can act on."""
    if not isinstance(reply, dict):
        raise ReplyRejected("the reply must be one JSON object")
    if set(reply) != {"rating", "recommendation", "conditions", "explanation"}:
        raise ReplyRejected('the fields must be exactly "rating", "recommendation", "conditions" and "explanation"')
    if not isinstance(reply["rating"], str) or reply["rating"] not in RATINGS:
        raise ReplyRejected(f'"rating" must be one of {list(RATINGS)}')
    if not isinstance(reply["recommendation"], str) or reply["recommendation"] not in RECOMMENDATIONS:
        raise ReplyRejected(f'"recommendation" must be one of {list(RECOMMENDATIONS)}')
    conditions, explanation = reply["conditions"], reply["explanation"]
    if not isinstance(conditions, list) or len(conditions) > MAX_ITEMS:
        raise ReplyRejected(f'"conditions" must be a list of at most {MAX_ITEMS} sentences')
    for item in conditions:
        if not isinstance(item, str) or not item.strip() or len(item) > MAX_SENTENCE:
            raise ReplyRejected('every item in "conditions" must be a short, non-empty sentence')
    if not isinstance(explanation, str) or not explanation.strip() or len(explanation) > MAX_EXPLANATION:
        raise ReplyRejected(f'"explanation" must be a non-empty text of at most {MAX_EXPLANATION} characters')
    allowed = _allowed_numbers(facts)
    for item in [*conditions, explanation]:
        for n in _numbers(item):
            if n not in allowed:
                raise ReplyRejected(f'"{item}" quotes {n:g}, which is not in DATA')
    # Code decides what a review flag or an LTV over the limit means. The reply cannot clear it.
    blocked = facts["price_needs_review"] is True or facts["purchase_ltv_within_limit"] is False or facts["model_ltv_within_limit"] is False
    if blocked and reply["recommendation"] == "Approve":
        raise ReplyRejected("you cannot recommend Approve when price_needs_review is true or a loan to value is over the limit")
    return reply


@dataclass
class AgentResult:
    ok: bool
    reply: dict | None
    failure_reason: str | None
    attempts: list[dict] = field(default_factory=list)


def _retryable(exc: clients.LlmError) -> bool:
    return exc.status is None or exc.status >= 500 or exc.status in RETRYABLE_CLIENT_ERRORS


def run(
    facts: dict,
    *,
    run_id: str,
    agent: config.AgentModel | None = None,
    transport: clients.Transport = clients.urllib_transport,
    env: dict | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> AgentResult:
    """Run the step with the model agents.json names for the valuation agent. Never calls any other model."""
    agent = agent or config.load().agent("valuation")
    prompt = build_prompt(facts)
    attempts: list[dict] = []
    error = None  # why the last reply was rejected, shown to the model on the retry
    invalid_retries = provider_retries = 0
    while True:
        sent = prompt if error is None else f"{prompt}\n\nYour previous reply was rejected: {error}. Reply again with only the corrected JSON object."
        t0 = time.monotonic()
        attempt = {
            "run_id": run_id, "attempt": len(attempts) + 1, "provider": agent.provider, "model": agent.model,
            "prompt_version": PROMPT_VERSION, "started_at": datetime.now(UTC).isoformat(), "raw_reply": None, "parsed_reply": None,
            "request_id": None, "input_tokens": None, "output_tokens": None, "outcome": None, "error": None,
        }
        retry = False
        try:
            got = clients.complete_json(agent.provider, agent.model, SYSTEM, sent, SCHEMA, transport=transport, env=env)
            attempt.update(raw_reply=got.raw_reply, request_id=got.request_id, input_tokens=got.input_tokens, output_tokens=got.output_tokens)
            attempt["parsed_reply"] = check_reply(got.parsed, facts)
            attempt["outcome"] = "ok"
        except ReplyRejected as exc:
            attempt.update(outcome="invalid_reply", error=str(exc))
            error, invalid_retries, retry = str(exc), invalid_retries + 1, invalid_retries < INVALID_REPLY_RETRIES
        except clients.InvalidReply as exc:  # not JSON, or JSON that breaks the schema
            attempt.update(outcome="invalid_reply", error=str(exc), raw_reply=exc.raw_reply, request_id=exc.request_id,
                           input_tokens=exc.input_tokens, output_tokens=exc.output_tokens)
            error, invalid_retries, retry = str(exc), invalid_retries + 1, invalid_retries < INVALID_REPLY_RETRIES
        except clients.MissingKey as exc:  # nothing was sent and asking again cannot help
            attempt.update(outcome="missing_key", error=str(exc))
        except clients.LlmError as exc:  # a timeout or an outage or a rate limit, or a wrong key
            attempt.update(outcome="provider_error", error=str(exc))
            retry = _retryable(exc) and provider_retries < PROVIDER_RETRIES
        attempt["duration_s"] = round(time.monotonic() - t0, 3)
        attempts.append(attempt)
        log.info(json.dumps(attempt))
        if attempt["outcome"] == "ok":
            return AgentResult(True, attempt["parsed_reply"], None, attempts)
        if not retry:
            return AgentResult(False, None, attempt["error"], attempts)
        if attempt["outcome"] == "provider_error":
            sleep(BACKOFF_S[provider_retries])
            provider_retries += 1


def made_up_application() -> dict:
    """A made-up application for a real run: a Cork semi-D, valued by the saved model, with the estimate worked out here and never typed in."""
    from app import valuation_model

    home = dict(county="Cork", property_type="Semi-D", bedrooms=3, floor_area_m2=111.0, ber="B")
    routing_key = "T12"
    estimate = valuation_model.estimate_value(*home.values(), routing_key)
    return build_facts(
        **home, routing_key=routing_key, asking_price_eur=round(estimate * 1.12, -3), loan_eur=round(estimate * 0.95, -3), estimate_eur=estimate,
        review_threshold=valuation_model.review_threshold(),
    )


def main(argv: list[str]) -> int:
    """A real run on a made-up application: cd al-ai && uv run python -m app.valuation_agent [provider ...]. Results go to docs/valuation-agent-runs.json."""
    from app.llm import smoke

    env = smoke.load_env()
    cfg = config.load()
    agents = [cfg.agent("valuation")] if not argv else [config.AgentModel(p, cfg.smoke_models()[p]) for p in argv]
    facts = made_up_application()
    runs = []
    for agent in agents:
        result = run(facts, agent=agent, run_id=f"demo-{agent.provider}", env=env)
        last = result.attempts[-1]
        print(f"{'passed' if result.ok else 'FAILED':7} {agent.provider:7} {agent.model:24} attempts={len(result.attempts)} {last['duration_s']}s "
              f"request {last['request_id']} {result.failure_reason or ''}")
        runs.append({"provider": agent.provider, "model": agent.model, "ok": result.ok, "failure_reason": result.failure_reason,
                     "reply": result.reply, "attempts": result.attempts})
    out = smoke.AL_AI / "docs" / "valuation-agent-runs.json"
    out.write_text(json.dumps({"what": "Real runs of the valuation agent step on one made-up application. No keys are stored here.",
                               "facts": facts, "runs": runs}, indent=1) + "\n")
    print("saved", out)
    return 0 if all(r["ok"] for r in runs) else 1


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    sys.exit(main(sys.argv[1:]))
