"""The reasoning trail (AL-62): each agent's report and vote, and the committee's consensus, as the `ai_runs` fields SCHEMA.md names.

`fields(record)` takes the committee's run record (committee.make_record) and returns the fields to add to the run's `ai_runs`
document: `agents`, `creditMemo`, `originalRecommendation`, `effectiveRecommendation` and `consensus`. It only reads the record:
nothing is worked out again and nothing is made up. An agent whose step did not finish is left out of `agents`, and a run that
did not get as far as the votes or the policy gate has null for those. A field an agent's reply does not have is null.
"""

VOTERS = ("affordability", "valuation", "strategist")  # Market & Macro reports but does not vote
STEP_FOR = {"affordability": "affordability", "valuation": "valuation_agent", "strategist": "strategist", "market": "market"}


def _list_text(items: list[str]) -> str:
    return "; ".join(items) if items else "none"


def _report(name: str, step: dict) -> str:
    """The text the agent wrote. The affordability reply has no free text, so its report is its reply written out in a fixed form."""
    reply = step["output"]
    if name == "affordability":
        return (
            f"Rating: {reply['rating']}. Recommendation: {reply['recommendation']}.\n"
            f"Concerns: {_list_text(reply['concerns'])}.\nConditions: {_list_text(reply['conditions'])}."
        )
    if name == "valuation":
        return reply["explanation"]
    if name == "strategist":
        return step["memo"]
    return reply["summary"]


def _agent(name: str, step: dict) -> dict:
    reply = step["output"]
    voting = name in VOTERS
    return {
        "provider": step["provider"], "model": step["model"], "promptVersion": step["prompt_version"], "report": _report(name, step),
        "recommendation": reply["recommendation"] if voting else None,
        "rating": reply.get("rating") if voting else None,
        "concerns": reply.get("concerns") if voting else None,
        "conditions": reply["conditions"] if voting else None,
    }


def fields(record: dict) -> dict:
    steps = record.get("steps", {})
    agents = {name: _agent(name, steps[step]) for name, step in STEP_FOR.items() if steps.get(step, {}).get("ok")}
    consensus = None
    if all(name in agents for name in VOTERS):
        votes = {name: agents[name]["recommendation"] for name in VOTERS}
        consensus = {"votes": votes, "disagreement": len(set(votes.values())) > 1}  # no majority rule: the underwriter sees all three
    strategist = agents.get("strategist")
    return {
        "agents": agents,
        "creditMemo": strategist["report"] if strategist else None,
        "originalRecommendation": record.get("original_recommendation"),
        "effectiveRecommendation": record.get("effective_recommendation"),
        "consensus": consensus,
    }
