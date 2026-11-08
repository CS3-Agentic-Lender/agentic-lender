"""The credit committee as one fixed LangGraph flow, runnable on a synthetic application file.

    validate -> valuation model -> Market & Macro -> code calculations -> (affordability agent | valuation agent)
             -> strategist -> policy gate -> save

Nobody decides the route: the order is fixed. The two agents that need only the calculations run side by side and the
strategist waits for both. Every step is required. A step that fails after its retries is recorded and the steps after it
skip themselves, so the run is still saved, as failed, with the evidence so far and no recommendation (AL-138 decision 3).
The state holds each step's result under `steps`; the save step turns it into the run record that `RunStore` keeps.

    cd al-ai && uv run python -m app.committee app/committee_samples/mortgage-application.json
"""

import dataclasses
import json
import logging
import time
import uuid
from datetime import UTC, date, datetime
from operator import add
from pathlib import Path
from typing import Annotated, Callable, Protocol, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import ValidationError

from app import affordability_agent as aa
from app import committee_input, official_rates, policy_gate, rates, retry_policy, serper, valuation_endpoint, valuation_model
from app import market_agent as ma
from app import strategist_agent as sa
from app import valuation_agent as va
from app.llm import clients, config

log = logging.getLogger("al-ai.committee")

AL_AI = Path(__file__).resolve().parents[1]
SAMPLES = Path(__file__).with_name("committee_samples")
RUNS_FOLDER = AL_AI / "docs" / "committee-runs"
NODE_ORDER = ("validate", "valuation_model", "market", "calculations", "affordability", "valuation_agent", "strategist", "policy_gate", "save")


class StepFailed(Exception):
    """A required step could not finish. `evidence` is kept in the run record (for example the attempts made)."""

    def __init__(self, reason: str, evidence: dict | None = None):
        super().__init__(reason)
        self.reason, self.evidence = reason, evidence or {}


class RunStore(Protocol):
    def save(self, record: dict) -> None: ...


class JsonFileRunStore:
    """One JSON file per run in a folder. The Firestore store, built with the submit trigger, keeps the same record."""

    def __init__(self, folder: Path = RUNS_FOLDER):
        self.folder = Path(folder)

    def path_for(self, run_id: str) -> Path:
        return self.folder / f"{run_id}.json"

    def load(self, run_id: str) -> dict:
        return json.loads(self.path_for(run_id).read_text())

    def save(self, record: dict) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        self.path_for(record["run_id"]).write_text(json.dumps(record, indent=1) + "\n")


@dataclasses.dataclass
class Deps:
    """What the flow uses from outside. Tests hand in fakes; the runner hands in the real ones."""

    store: RunStore
    report_store: ma.ReportStore
    get_rate: official_rates.GetRate = rates.get_rate  # the ECB rates; tests and the local runner hand in a fake cache (AL-291)
    today: str | None = None
    agents: dict[str, config.AgentModel] | None = None  # None: the models agents.json names
    search: Callable[..., serper.SearchResult] = serper.search
    transport: clients.Transport = clients.urllib_transport
    env: dict | None = None
    sleep: Callable[[float], None] = time.sleep
    budget_s: float = retry_policy.RUN_BUDGET_S  # the whole run's time budget (AL-139)
    clock: Callable[[], float] = time.monotonic

    def agent(self, name: str) -> config.AgentModel | None:
        return (self.agents or {}).get(name)


def _merge(old: dict, new: dict) -> dict:
    return {**old, **new}


class State(TypedDict, total=False):
    """What travels through the graph. The three Annotated fields take writes from nodes that run side by side."""

    run_id: str
    application_id: str
    application: dict
    started_at: str
    inputs: committee_input.Application
    steps: Annotated[dict, _merge]  # step name -> that step's result
    failures: Annotated[list, add]  # {"step", "reason"}; the first one is the run's failed step
    node_order: Annotated[list, add]  # the nodes that actually ran
    rates: official_rates.RunRates  # the ECB rates this run uses, fetched by the market step
    rerun_of: str | None  # the failed run this one repeats
    record: dict


def _failure(name: str, reason: str, evidence: dict | None = None) -> dict:
    return {
        "node_order": [name],
        "steps": {name: {"ok": False, "error": reason, **(evidence or {})}},
        "failures": [{"step": name, "reason": reason}],
    }


def _node(name: str, work: Callable[[State], dict], budget: retry_policy.Budget):
    """Wrap a step: skip it once an earlier step has failed or the run's time is up, and turn StepFailed into a failure on the record."""

    def run(state: State) -> dict:
        if state.get("failures"):
            return {}
        if budget.remaining() <= 0:
            return _failure(name, budget.reason())
        try:
            update = work(state)
        except StepFailed as exc:
            return _failure(name, exc.reason, exc.evidence)
        except Exception as exc:  # a bug or an outage nobody planned for must still leave a failed record, not lose the run
            log.exception("committee step %s raised", name)
            return _failure(name, f"unexpected error: {type(exc).__name__}: {exc}"[:300])
        return {"node_order": [name], **update}

    return run


def _llm_result(name: str, result: va.AgentResult, extra: dict | None = None) -> dict:
    if not result.attempts:  # the run's time ran out before the step's first call: there is nothing to record but the reason
        raise StepFailed(result.failure_reason or "the step failed")
    last = result.attempts[-1]
    evidence = {"provider": last["provider"], "model": last["model"], "prompt_version": last["prompt_version"], "attempts": result.attempts}
    if not result.ok:
        raise StepFailed(result.failure_reason or "the step failed", evidence)
    return {"steps": {name: {"ok": True, "output": result.reply, **evidence, **(extra or {})}}}


def build_graph(deps: Deps):
    budget = retry_policy.Budget(deps.budget_s, deps.clock)  # one per run: the graph is built once for each run

    def ids(state: State) -> dict:
        """The three IDs every logged call carries, under the names the AI call log reads."""
        return {"run_id": state["run_id"], "application_id": state["application_id"], "broker_id": state["inputs"].broker_id}

    def validate(state: State) -> dict:
        try:
            application = committee_input.Application.model_validate(state["application"])
            application.valuation_request()  # a county, property type or BER the model does not know fails here, before any model call
        except ValidationError as exc:
            raise StepFailed(f"the application is not valid: {committee_input.problems(exc)}")
        if not application.broker_id:  # every call is logged against a broker, so a run without one never starts
            raise StepFailed("the application has no brokerId, so the run cannot be logged against a broker")
        return {"inputs": application, "steps": {"validate": {"ok": True, "output": {"loan_type": application.loan_type}}}}

    def valuation_model_step(state: State) -> dict:
        try:
            response, breakdown_error = valuation_endpoint.estimate_home(state["inputs"].valuation_request(state["run_id"]))
        except valuation_model.ValuationUnavailable as exc:
            raise StepFailed(str(exc))
        return {"steps": {"valuation_model": {
            "ok": True, **ids(state), "model_version": response.model_version, "output": response.model_dump(), "breakdown_error": breakdown_error,
        }}}

    def market(state: State) -> dict:
        """The first step that needs a rate, so a rate that cannot be had fails the run here, before any model call."""
        try:
            run_rates = official_rates.load(deps.get_rate, deps.today or date.today().isoformat())
        except rates.RateUnavailable as exc:
            raise StepFailed(str(exc))
        got = ma.get_report(
            run_rates.official, store=deps.report_store, run_id=state["run_id"], today=deps.today, agent=deps.agent("market"),
            search=deps.search, transport=deps.transport, env=deps.env, sleep=deps.sleep, budget=budget, context=ids(state),
        )
        evidence = {"attempts": got.attempts, "searches": got.searches, "rates": run_rates.evidence()}
        if not got.ok:
            raise StepFailed(got.failure_reason or "the market report failed", evidence)
        report = got.report
        return {"rates": run_rates, "steps": {"market": {
            "ok": True, "output": report, "report_id": report["report_id"], "reused_report_id": got.reused_report_id,
            "provider": report["provider"], "model": report["model"], "prompt_version": report["prompt_version"], **evidence,
        }}}

    def calculations(state: State) -> dict:
        """Every figure the agents will quote and every limit the policy gate will judge, worked out by code."""
        a, steps = state["inputs"], state["steps"]
        valuation = steps["valuation_model"]["output"]
        heloc = a.loan_type == "heloc"
        try:
            affordability_facts = aa.build_facts(
                loan=a.loan_amount_eur, years=a.term_years, benchmark_rate=state["rates"].benchmark_rate_pct / 100,
                gross_annual_income=a.gross_income_eur, net_monthly_income=a.monthly_take_home_eur, monthly_debts=a.monthly_debts_eur,
                monthly_living_costs=a.monthly_living_costs_eur, first_time_buyer=bool(a.first_time_buyer) and not heloc,
            )
            valuation_facts = va.build_facts(
                county=a.property.county, property_type=a.property.property_type, bedrooms=a.property.bedrooms,
                floor_area_m2=a.property.floor_area_m2, ber=a.property.ber, routing_key=a.property.eircode[:3],
                asking_price_eur=a.property.asking_price_eur, loan_eur=a.loan_amount_eur, estimate_eur=valuation["estimate_eur"],
                review_threshold=valuation_model.review_threshold(), support_warnings=tuple(valuation["support_warnings"]),
                loan_type=a.loan_type, existing_mortgage_balance_eur=a.existing_mortgage_balance_eur,
            )
            if heloc:
                breaches = policy_gate.heloc_breaches(
                    existing_balance=a.existing_mortgage_balance_eur, line=a.loan_amount_eur,
                    home_value=valuation["estimate_eur"], gross_annual_income=a.gross_income_eur,
                )
            else:
                breaches = policy_gate.purchase_breaches(
                    loan=a.loan_amount_eur, gross_annual_income=a.gross_income_eur,
                    first_time_buyer=bool(a.first_time_buyer), asking_price=a.property.asking_price_eur,
                )
        except ValueError as exc:
            raise StepFailed(f"the figures could not be worked out: {exc}")
        output = {
            "benchmark_rate_pct": state["rates"].benchmark_rate_pct, "benchmark_rate_month": state["rates"].benchmark_rate_month, "affordability_facts": affordability_facts,
            "valuation_facts": valuation_facts, "breaches": list(breaches),
        }
        return {"steps": {"calculations": {"ok": True, "output": output}}}

    def affordability(state: State) -> dict:
        facts = state["steps"]["calculations"]["output"]["affordability_facts"]
        result = aa.run(facts, run_id=state["run_id"], agent=deps.agent("affordability"), transport=deps.transport, env=deps.env, sleep=deps.sleep, budget=budget, context=ids(state))
        return _llm_result("affordability", result)

    def valuation_agent(state: State) -> dict:
        facts = state["steps"]["calculations"]["output"]["valuation_facts"]
        result = va.run(facts, run_id=state["run_id"], agent=deps.agent("valuation"), transport=deps.transport, env=deps.env, sleep=deps.sleep, budget=budget, context=ids(state))
        return _llm_result("valuation_agent", result)

    def strategist(state: State) -> dict:
        a, steps = state["inputs"], state["steps"]
        loan = dict(
            loan_type=a.loan_type, loan_eur=a.loan_amount_eur, term_years=a.term_years, first_time_buyer=bool(a.first_time_buyer),
            county=a.property.county, property_type=a.property.property_type, bedrooms=a.property.bedrooms,
        )
        if a.loan_type == "mortgage":
            loan["asking_price_eur"] = a.property.asking_price_eur
        try:
            facts = sa.build_facts(
                loan=loan, affordability=steps["affordability"]["output"], valuation=steps["valuation_agent"]["output"],
                market=steps["market"]["output"],
            )
        except ValueError as exc:
            raise StepFailed(f"the strategist could not be given the reports: {exc}")
        result = sa.run(facts, run_id=state["run_id"], agent=deps.agent("strategist"), transport=deps.transport, env=deps.env, sleep=deps.sleep, budget=budget, context=ids(state))
        return _llm_result("strategist", result, {"memo": sa.render_memo(result.reply) if result.ok else None})

    def gate(state: State) -> dict:
        steps = state["steps"]
        reply = steps["strategist"]["output"]
        try:
            result = policy_gate.apply_policy_gate(
                reply["recommendation"], reply["conditions"], steps["calculations"]["output"]["breaches"], loan_type=state["inputs"].loan_type
            )
        except ValueError as exc:
            raise StepFailed(f"the policy gate refused its inputs: {exc}")
        output = {**dataclasses.asdict(result), "conditions": list(result.conditions), "breaches": list(result.breaches)}
        return {"steps": {"policy_gate": {"ok": True, "output": output}}}

    def save(state: State) -> dict:
        """Always runs, whether the run finished or failed, so every run leaves a record."""
        record = make_record(state)
        deps.store.save(record)
        return {"record": record, "node_order": ["save"]}

    graph = StateGraph(State)
    for name, work in (
        ("validate", validate), ("valuation_model", valuation_model_step), ("market", market), ("calculations", calculations),
        ("affordability", affordability), ("valuation_agent", valuation_agent), ("strategist", strategist), ("policy_gate", gate),
    ):
        graph.add_node(name, _node(name, work, budget))
    graph.add_node("save", save)

    graph.add_edge(START, "validate")
    graph.add_edge("validate", "valuation_model")
    graph.add_edge("valuation_model", "market")
    graph.add_edge("market", "calculations")
    graph.add_edge("calculations", "affordability")
    graph.add_edge("calculations", "valuation_agent")
    graph.add_edge(["affordability", "valuation_agent"], "strategist")  # waits for both
    graph.add_edge("strategist", "policy_gate")
    graph.add_edge("policy_gate", "save")
    graph.add_edge("save", END)
    return graph.compile()


def make_record(state: State) -> dict:
    """The run record from AL-138 decision 1: one document per run, the steps nested inside. Called by the save node, so it adds itself to the order."""
    steps = state.get("steps", {})
    # The two agents run side by side and may both fail: the earlier step in the flow is the one reported, whichever finished first.
    failures = sorted(state.get("failures", []), key=lambda failure: NODE_ORDER.index(failure["step"]))
    gate = steps.get("policy_gate", {}).get("output")
    inputs = state.get("inputs")
    broker_id = inputs.broker_id if inputs else None
    calls = [
        {"id": f"{state['run_id']}-{name}-{attempt['attempt']}", "step": name, "application_id": state["application_id"], "broker_id": broker_id}
        for name, step in steps.items() for attempt in step.get("attempts", [])
    ]
    return {
        "run_id": state["run_id"],
        "application_id": state["application_id"],
        "broker_id": broker_id,
        "rerun_of": state.get("rerun_of"),
        "status": "failed" if failures else "complete",
        "started_at": state["started_at"],
        "finished_at": datetime.now(UTC).isoformat(),
        "failed_step": failures[0]["step"] if failures else None,
        "failure_reason": failures[0]["reason"] if failures else None,
        "steps": steps,
        "original_recommendation": gate["original"] if gate else None,
        "effective_recommendation": gate["effective"] if gate else None,
        "ai_calls": calls,
        "node_order": [*state["node_order"], "save"],
    }


def run_committee(application: dict, *, deps: Deps, application_id: str, run_id: str | None = None, rerun_of: str | None = None) -> dict:
    """Run the whole flow once and return the saved record. `rerun_of` is the failed run this one repeats."""
    final = build_graph(deps).invoke({
        "run_id": run_id or str(uuid.uuid4()), "application_id": application_id, "application": application,
        "started_at": datetime.now(UTC).isoformat(), "steps": {}, "failures": [], "node_order": [], "rerun_of": rerun_of,
    })
    return final["record"]


def rerun_committee(failed: dict, application: dict, *, deps: Deps) -> dict:
    """Run the committee again for a failed run: a new run ID, linked to the failed one. The failed record is left as it is.

    The record holds no application figures, so the caller hands in the application again (the Firestore document, by application_id).
    Only a failed run can be re-run: a complete one stands until an underwriter makes a decision on it.
    """
    if failed.get("status") != "failed":
        raise ValueError(f"run {failed.get('run_id')} did not fail, so it cannot be re-run")
    return run_committee(application, deps=deps, application_id=failed["application_id"], rerun_of=failed["run_id"])


def local_deps(store: RunStore, env: dict) -> Deps:
    """The real providers, for the Firestore listener: the ECB rates come from the shared Firestore cache (`rates_cache`)."""
    return Deps(store=store, report_store=ma.MemoryReportStore(), env=env)


def main(argv: list[str]) -> int:
    """cd al-ai && uv run python -m app.committee APPLICATION.json [--rates CACHE.json] [--out FOLDER] [--rerun FAILED_RUN_ID]

    The runner needs no Firestore. The ECB rates come from an in-memory cache: filled from CACHE.json (`rates_cache` documents by name,
    with `fetchedAt` as an ISO time) when given, else empty, so the rates are fetched live from the ECB and kept for this run only.
    """
    from app.llm import smoke

    args = list(argv)
    options = {}
    for flag in ("--rates", "--out", "--rerun"):
        if flag in args:
            at = args.index(flag)
            options[flag] = args[at + 1]
            del args[at:at + 2]
    if len(args) != 1:
        print(main.__doc__)
        return 2
    path = Path(args[0])
    env = smoke.load_env()
    cache = rates.MemoryCache()
    if "--rates" in options:
        for name, doc in json.loads(Path(options["--rates"]).read_text()).items():
            cache.save(name, {**doc, "fetchedAt": datetime.fromisoformat(doc["fetchedAt"])})
    deps = Deps(
        store=JsonFileRunStore(Path(options.get("--out", RUNS_FOLDER))), report_store=ma.MemoryReportStore(),
        get_rate=lambda name: rates.get_rate(name, cache=cache), env=env,
    )
    application = json.loads(path.read_text())
    if "--rerun" in options:
        record = rerun_committee(deps.store.load(options["--rerun"]), application, deps=deps)
        print(f"re-run of {record['rerun_of']}")
    else:
        record = run_committee(application, deps=deps, application_id=path.stem)
    print(f"{record['status']} run {record['run_id']}: {record['original_recommendation']} -> {record['effective_recommendation']}")
    if record["failed_step"]:
        print(f"failed at {record['failed_step']}: {record['failure_reason']}")
    print("saved", deps.store.path_for(record["run_id"]))
    return 0 if record["status"] == "complete" else 1


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    sys.exit(main(sys.argv[1:]))
