"""The strategist step: weighs the three reports and writes the credit memo with fixed headings.

It gets the affordability report, the valuation report, the market view and a loan summary, and nothing else: no name and no
contact details. The loan summary may hold only the fields chosen below, and every report is scanned for an email address, a
phone number or a full Eircode before anything is built. Code works out whether the two voting agents disagree. The reply is
checked against the schema, against the figures it was given and against that disagreement flag. Retries and logging are the
shared ones in app.agent_loop.
"""

import json
import logging
import re
import time
from pathlib import Path
from typing import Callable

from app import agent_loop
from app import market_agent as ma
from app import valuation_agent as va
from app.llm import clients, config

log = logging.getLogger("al-ai.strategist-agent")

PROMPT_VERSION = "strategist-agent-v1"
PROMPT_PATH = Path(__file__).parent / "prompts" / "strategist_agent_v1.md"
PROMPT = PROMPT_PATH.read_text()

SYSTEM = va.SYSTEM
RECOMMENDATIONS = ("Approve", "Conditionally Approve", "Decline")
SECTIONS = ("application_summary", "affordability", "property_assessment", "market_context", "disagreements", "recommendation_and_conditions")
HEADINGS = {  # the fixed headings of the credit memo
    "application_summary": "Application summary", "affordability": "Affordability", "property_assessment": "Property assessment",
    "market_context": "Market context", "disagreements": "Disagreements", "recommendation_and_conditions": "Recommendation and conditions",
}
SCHEMA = {
    "type": "object",
    "properties": {
        "recommendation": {"type": "string", "enum": list(RECOMMENDATIONS)},
        "conditions": {"type": "array", "items": {"type": "string"}},
        "memo": {
            "type": "object",
            "properties": {name: {"type": "string"} for name in SECTIONS},
            "required": list(SECTIONS),
            "additionalProperties": False,
        },
    },
    "required": ["recommendation", "conditions", "memo"],
    "additionalProperties": False,
}
LOAN_FIELDS = {"loan_type", "loan_eur", "term_years", "first_time_buyer", "county", "property_type", "bedrooms", "asking_price_eur"}
MAX_ITEMS = 5
MAX_SENTENCE = 300
MAX_SECTION = 700

ReplyRejected = ma.ReplyRejected

# What must never reach a prompt: an email address, a phone number, a full Eircode (a routing key such as "T12" is fine).
IDENTIFIERS = re.compile(
    r"[\w.+-]+@[\w-]+\.[\w.-]+"
    r"|(?:\+|00)\d[\d ()-]{7,}\d"
    r"|\b0\d{1,2}[ -]?\d{3}[ -]?\d{4}\b"
    r"|\b(?:[ACDEFHKNPRTVWXY]\d{2}|D6W)[ ]?[0-9ACDEFHKNPRTVWXY]{4}\b",
    re.I,
)


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def _allowed_numbers(value) -> set[float]:
    """Every figure anywhere in the facts, in the forms a memo may quote it. All of it is our own reports or the market summary,
    which the market step already checked, so none of it is raw search text."""
    if isinstance(value, bool) or value is None:
        return set()
    if isinstance(value, (int, float)):
        return {abs(float(value)), round(abs(value), 0), round(abs(value), 1)}
    if isinstance(value, str):
        return set(ma._numbers(value))
    items = value.values() if isinstance(value, dict) else value if isinstance(value, list) else ()
    return set().union(*(_allowed_numbers(v) for v in items))


def _vote(report, name: str) -> str:
    if not isinstance(report, dict) or report.get("recommendation") not in RECOMMENDATIONS:
        raise ValueError(f"the {name} report must carry a recommendation of {list(RECOMMENDATIONS)}")
    return report["recommendation"]


def build_facts(*, loan: dict, affordability: dict, valuation: dict, market: dict) -> dict:
    """The only things the strategist sees. Raises ValueError if a field was not chosen or a report holds a personal identifier."""
    extra = set(loan) - LOAN_FIELDS
    if extra:
        raise ValueError(f"the loan summary may not hold {sorted(extra)}: it has no name and no contact details")
    votes = {"Affordability": _vote(affordability, "affordability"), "Valuation": _vote(valuation, "valuation")}
    if not isinstance(market, dict) or market.get("outlook") not in ma.OUTLOOKS or not isinstance(market.get("summary"), str):
        raise ValueError("the market report must carry an outlook and a summary")
    facts = {
        "loan": dict(loan),
        "affordability_report": affordability,
        "valuation_report": valuation,
        "market_report": {"outlook": market["outlook"], "summary": market["summary"]},  # no links: the memo may not carry any
        "votes": votes,
        "voting_agents_disagree": votes["Affordability"] != votes["Valuation"],
    }
    for text in _strings(facts):
        if IDENTIFIERS.search(text):
            raise ValueError("a report holds what looks like a personal identifier, so nothing is sent to the model")
    return facts


def build_prompt(facts: dict) -> str:
    return PROMPT.replace("{data}", json.dumps(facts, indent=2))


def check_reply(reply, facts: dict) -> dict:
    """Check a parsed reply. Raises ReplyRejected with a message the model can act on."""
    if not isinstance(reply, dict):
        raise ReplyRejected("the reply must be one JSON object")
    if set(reply) != {"recommendation", "conditions", "memo"}:
        raise ReplyRejected('the fields must be exactly "recommendation", "conditions" and "memo"')
    if not isinstance(reply["recommendation"], str) or reply["recommendation"] not in RECOMMENDATIONS:
        raise ReplyRejected(f'"recommendation" must be one of {list(RECOMMENDATIONS)}')
    conditions, memo = reply["conditions"], reply["memo"]
    if not isinstance(conditions, list) or len(conditions) > MAX_ITEMS:
        raise ReplyRejected(f'"conditions" must be a list of at most {MAX_ITEMS} sentences')
    for item in conditions:
        if not isinstance(item, str) or not item.strip() or len(item) > MAX_SENTENCE:
            raise ReplyRejected('every item in "conditions" must be a short, non-empty sentence')
    if not isinstance(memo, dict) or set(memo) != set(SECTIONS):
        raise ReplyRejected(f'"memo" must have exactly these sections: {list(SECTIONS)}')
    for name in SECTIONS:
        text = memo[name]
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_SECTION:
            raise ReplyRejected(f'the memo section "{name}" must be non-empty text of at most {MAX_SECTION} characters')
    if facts["voting_agents_disagree"]:
        text = memo["disagreements"].lower()
        if "affordability" not in text or "valuation" not in text:
            raise ReplyRejected('the agents disagree, so the "disagreements" section must name the Affordability agent and the Valuation agent')
    allowed = _allowed_numbers(facts)
    for text in [*conditions, *memo.values()]:
        if re.search(r"https?://|www\.", text):
            raise ReplyRejected(f'"{text}" has a link, and the memo may not carry any')
        for n in ma._numbers(text):
            if n not in allowed:
                raise ReplyRejected(f'"{text}" quotes {n:g}, which is not in DATA')
    return reply


def render_memo(reply: dict) -> str:
    """The memo with its fixed headings, in order. The same reply always gives the same text, so it can be hashed."""
    return "\n\n".join(f"## {HEADINGS[name]}\n{reply['memo'][name]}" for name in SECTIONS) + "\n"


def run(
    facts: dict,
    *,
    run_id: str,
    agent: config.AgentModel | None = None,
    transport: clients.Transport = clients.urllib_transport,
    env: dict | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> va.AgentResult:
    """Run the step with the model agents.json names for the strategist. Never calls any other model."""
    agent = agent or config.load().agent("strategist")
    return agent_loop.run_step(
        log=log, agent=agent, prompt=build_prompt(facts), system=SYSTEM, schema=SCHEMA, check=lambda reply: check_reply(reply, facts),
        run_id=run_id, prompt_version=PROMPT_VERSION, transport=transport, env=env, sleep=sleep,
    )


def made_up_reports() -> dict:
    """Inputs for a real run. The valuation and market reports are the saved real ones. The affordability report is made up
    (it needs the local Ollama model) and recommends Approve, so the two voting agents disagree."""
    from app.llm import smoke

    valuation = json.loads((smoke.AL_AI / "docs" / "valuation-agent-runs.json").read_text())["runs"][0]["reply"]
    market = json.loads((smoke.AL_AI / "docs" / "market-agent-runs.json").read_text())["runs"][0]["report"]
    affordability = {"rating": "adequate", "recommendation": "Approve", "concerns": ["Spare income is thin once rates rise 2 points."], "conditions": []}
    loan = dict(loan_type="purchase", loan_eur=402000.0, term_years=30, first_time_buyer=True, county="Cork", property_type="Semi-D", bedrooms=3, asking_price_eur=474000.0)
    return dict(loan=loan, affordability=affordability, valuation=valuation, market=market)


def main(argv: list[str]) -> int:
    """A real run: cd al-ai && uv run python -m app.strategist_agent. Results go to docs/strategist-agent-runs.json."""
    from app.llm import smoke

    env = smoke.load_env()
    inputs = made_up_reports()
    facts = build_facts(**inputs)
    result = run(facts, run_id="demo-strategist", env=env)
    last = result.attempts[-1]
    print(f"{'passed' if result.ok else 'FAILED'} {last['provider']} {last['model']} attempts={len(result.attempts)} {last['duration_s']}s {result.failure_reason or ''}")
    if result.ok:
        print(render_memo(result.reply))
    out = smoke.AL_AI / "docs" / "strategist-agent-runs.json"
    out.write_text(json.dumps({
        "what": "A real run of the strategist step. The valuation and market reports are saved real runs and the affordability report is made up. No keys are stored here.",
        "facts": facts, "ok": result.ok, "failure_reason": result.failure_reason, "reply": result.reply,
        "memo": render_memo(result.reply) if result.ok else None, "attempts": result.attempts,
    }, indent=1) + "\n")
    print("saved", out)
    return 0 if result.ok else 1


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    sys.exit(main(sys.argv[1:]))
