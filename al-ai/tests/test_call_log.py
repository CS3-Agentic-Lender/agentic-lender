"""Every AI call behind a decision is saved as one ai_calls document (AL-140). Fake providers and a fake sink: no network, no Firestore.

The emulator checks of the real Firestore sink are in test_call_log_firestore.py.
"""

import copy
import json
from datetime import datetime

import pytest

import test_committee as tc
import test_market_agent as tm
from app import call_log, committee
from app import market_agent as ma
from app.call_log import AlreadyStored, CallLogError

RUN = "run-1"


class MemorySink:
    """The documents by id. `create` refuses an id that exists, like the real one. `fail` makes the first n creates raise."""

    def __init__(self, fail: int = 0):
        self.docs, self.fail, self.attempts = {}, fail, 0

    def create(self, doc_id, doc):
        self.attempts += 1
        if self.fail:
            self.fail -= 1
            raise OSError("the store went away")
        if doc_id in self.docs:
            raise AlreadyStored(doc_id)
        self.docs[doc_id] = copy.deepcopy(doc)

    def get(self, doc_id):
        return self.docs.get(doc_id)


def run(application=tc.MORTGAGE, providers=None, sink=None, report_store=None, search=None, env=None):
    providers = providers or tc.Providers()
    sink = sink if sink is not None else MemorySink()
    store = tc.MemoryRunStore()
    deps = committee.Deps(
        store=store, report_store=report_store or tc.a_report_for_today(), official=tc.OFFICIAL, benchmark_rate_pct=4.0, today=tc.TODAY,
        agents=tc.AGENTS, transport=providers, env=env or tc.ENV, sleep=lambda s: None, call_sink=sink,
        search=search or (lambda *a, **k: pytest.fail("the day's report exists, so no search should run")),
    )
    record = committee.run_committee(application, deps=deps, application_id="app-1", run_id=RUN)
    return record, sink, providers


# ---- AC1: every call writes one document with everything the ticket lists ----------------------------------------------


def test_a_complete_run_saves_one_document_for_each_call_and_they_line_up_with_the_run_record():
    record, sink, _ = run()
    assert record["status"] == "complete"
    model_calls = {f"{RUN}-{step}-1" for step in ("affordability", "valuation_agent", "strategist")}
    assert set(sink.docs) == model_calls | {f"{RUN}-valuation_model-1", f"{RUN}-market-reused"}
    assert {call["id"] for call in record["ai_calls"]} == model_calls  # the ids the run record lists are documents


def test_a_model_attempt_document_holds_everything_the_ticket_lists():
    _, sink, _ = run()
    doc = sink.docs[f"{RUN}-affordability-1"]
    assert (doc["runId"], doc["applicationId"], doc["brokerId"]) == (RUN, "app-1", tc.MORTGAGE["brokerId"])
    assert (doc["agent"], doc["provider"], doc["model"]) == ("affordability", "ollama", "qwen3.5:9b")
    assert (doc["attempt"], doc["promptVersion"], doc["outcome"], doc["error"], doc["reusedFrom"]) == (1, "affordability-agent-v1", "ok", None, None)
    assert doc["parsedReply"] == tc.AFFORDABILITY and json.loads(doc["output"]) == tc.AFFORDABILITY
    assert isinstance(doc["rawReply"], str) and json.loads(doc["rawReply"]) == tc.AFFORDABILITY
    assert doc["request"]["system"] and doc["request"]["prompt"] and doc["request"]["schema"]["required"]
    assert isinstance(doc["latencyMs"], int) and doc["latencyMs"] >= 0
    assert all(isinstance(doc[key], datetime) and doc[key].tzinfo for key in ("startedAt", "endedAt", "createdAt"))
    assert doc["startedAt"] <= doc["endedAt"] and doc["createdAt"] == doc["endedAt"]
    assert {"requestId", "inputTokens", "outputTokens"} <= set(doc)


def test_the_valuation_agent_step_is_called_valuation_but_keeps_the_run_records_id():
    _, sink, _ = run()
    doc = sink.docs[f"{RUN}-valuation_agent-1"]
    assert doc["agent"] == "valuation" and (doc["provider"], doc["model"]) == ("groq", "openai/gpt-oss-120b")


def test_the_valuation_model_call_is_saved_with_its_inputs_and_answer():
    record, sink, _ = run()
    doc = sink.docs[f"{RUN}-valuation_model-1"]
    assert (doc["agent"], doc["provider"], doc["outcome"], doc["error"]) == ("valuation_model", "al-ai", "ok", None)
    assert doc["parsedReply"]["estimate_eur"] == record["steps"]["valuation_model"]["output"]["estimate_eur"]
    assert doc["model"] == record["steps"]["valuation_model"]["model_version"]
    assert doc["request"]["county"] == tc.MORTGAGE["property"]["county"]
    assert (doc["runId"], doc["applicationId"], doc["brokerId"]) == (RUN, "app-1", tc.MORTGAGE["brokerId"])


# ---- AC2: every retry is its own document; a reused report links to the call that made it -------------------------------


def test_every_retry_is_its_own_document_and_shows_what_was_sent_the_second_time():
    bad = {**tc.AFFORDABILITY, "rating": "not-a-rating"}
    providers = tc.Providers(ollama=bad)
    providers.replies["ollama.test"] = [bad, tc.AFFORDABILITY]
    _, sink, _ = run(providers=providers)
    first, second = sink.docs[f"{RUN}-affordability-1"], sink.docs[f"{RUN}-affordability-2"]
    assert (first["outcome"], second["outcome"]) == ("invalid_reply", "ok")
    assert first["error"] and "rejected" in second["request"]["prompt"] and "rejected" not in first["request"]["prompt"]
    assert first["parsedReply"] is None and first["output"] is None and second["output"]
    assert first["rawReply"] and first["endedAt"] <= second["startedAt"]


def test_a_failed_run_still_saves_every_attempt_it_made_and_nothing_after_the_failed_step():
    record, sink, _ = run(providers=tc.Providers(ollama=(503, b"down")))
    assert record["status"] == "failed" and record["failed_step"] == "affordability"
    docs = [sink.docs[f"{RUN}-affordability-{n}"] for n in (1, 2, 3)]
    assert {d["outcome"] for d in docs} == {"provider_error"} and all(d["error"] and d["rawReply"] is None for d in docs)
    assert not any(key.startswith(f"{RUN}-strategist") for key in sink.docs)


def test_a_reused_market_report_is_a_document_that_links_to_the_original_call():
    reports = tc.a_report_for_today()
    key = ma.report_key(tc.OFFICIAL, tc.TODAY)
    reports.put(key, {**reports.get(key), "call_id": "earlier-market-2"})
    _, sink, _ = run(report_store=reports)
    doc = sink.docs[f"{RUN}-market-reused"]
    assert (doc["outcome"], doc["reusedFrom"], doc["agent"]) == ("reused", "earlier-market-2", "market")
    assert (doc["provider"], doc["model"]) == ("gemini", "gemini-3.1-flash-lite")
    assert doc["request"] is None and doc["rawReply"] is None and doc["latencyMs"] is None
    assert not any(key.startswith(f"{RUN}-market-search") or key == f"{RUN}-market-1" for key in sink.docs)  # no new call pretends to have run


def test_a_new_market_report_saves_each_search_and_the_model_call_and_a_later_run_links_to_them():
    net, first, reports = tm.Net(), MemorySink(), ma.MemoryReportStore()
    ids = {"run_id": "run-a", "application_id": "app-1", "broker_id": "broker-1"}
    got = ma.get_report(
        tm.OFFICIAL, store=reports, run_id="run-a", today=tm.TODAY, agent=tm.GEMINI, transport=net, env=tm.ENV,
        sleep=lambda s: None, context=ids, record=call_log.recorder(first, "market"),
    )
    assert got.ok
    searches = [first.docs[f"run-a-market-search-{n}"] for n in range(1, len(ma.QUERIES) + 1)]
    assert [d["request"]["search"] for d in searches] == list(ma.QUERIES)
    assert all(d["provider"] == "serper" and d["outcome"] == "ok" and d["parsedReply"] and d["rawReply"] is None for d in searches)
    assert all(d["agent"] == "market" and (d["runId"], d["brokerId"]) == ("run-a", "broker-1") for d in searches)
    model = first.docs["run-a-market-1"]
    assert (model["provider"], model["outcome"]) == ("gemini", "ok") and model["parsedReply"]["outlook"] == "stable"
    assert got.report["call_id"] == "run-a-market-1"

    second = MemorySink()
    again = ma.get_report(
        tm.OFFICIAL, store=reports, run_id="run-b", today=tm.TODAY, agent=tm.GEMINI, transport=tm.Net(), env=tm.ENV,
        sleep=lambda s: None, context={**ids, "run_id": "run-b"}, record=call_log.recorder(second, "market"),
    )
    assert again.reused_report_id and list(second.docs) == ["run-b-market-reused"]
    assert second.docs["run-b-market-reused"]["reusedFrom"] == "run-a-market-1"


def test_a_search_that_fails_is_saved_with_its_error():
    sink = MemorySink()
    net = tm.Net(serper_status=500)
    got = ma.get_report(
        tm.OFFICIAL, store=ma.MemoryReportStore(), run_id="run-a", today=tm.TODAY, agent=tm.GEMINI,
        transport=net, env=tm.ENV, sleep=lambda s: None, context={"run_id": "run-a", "application_id": "app-1", "broker_id": "broker-1"},
        record=call_log.recorder(sink, "market"),
    )
    assert not got.ok
    doc = sink.docs["run-a-market-search-1"]
    assert doc["outcome"] == "error" and "HTTP 500" in doc["error"] and doc["parsedReply"] == []


# ---- AC3: a key or an auth header never appears in a document -----------------------------------------------------------

SECRET = "SECRET-KEY-do-not-leak-0123456789"


def everything(sink) -> str:
    return json.dumps(sink.docs, default=str)


def test_no_key_or_auth_header_is_in_any_document_of_a_whole_run():
    env = {"GROQ_API_KEY": SECRET, "GEMINI_API_KEY": SECRET, "SERPER_API_KEY": SECRET, "OLLAMA_HOST": "http://ollama.test:11434"}
    reports = ma.MemoryReportStore()
    net = tm.Net()

    class Both(tc.Providers):  # the market step also needs Serper and the market reply from Gemini
        def __call__(self, url, headers, body, timeout):
            if "serper" in url or ("generativelanguage" in url and "outlook" in json.dumps(json.loads(body))):
                return net(url, headers, body, timeout)
            return super().__call__(url, headers, body, timeout)

    deps = committee.Deps(
        store=tc.MemoryRunStore(), report_store=reports, official=tm.OFFICIAL, benchmark_rate_pct=4.0, today=tm.TODAY,
        agents=tc.AGENTS, transport=Both(), env=env, sleep=lambda s: None, call_sink=(sink := MemorySink()),
    )
    committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1", run_id=RUN)
    assert len(sink.docs) >= 4
    text = everything(sink)
    assert SECRET not in text
    assert not any(word in text.lower() for word in ("x-api-key", "authorization", "bearer ", "api_key"))


def test_a_provider_error_that_echoes_the_key_is_saved_without_it():
    env = {**tc.ENV, "GROQ_API_KEY": SECRET}
    _, sink, _ = run(providers=tc.Providers(groq=(401, f"invalid key {SECRET}".encode())), env=env)
    doc = sink.docs[f"{RUN}-valuation_agent-1"]
    assert doc["outcome"] == "provider_error" and doc["error"] and "[key]" in doc["error"]
    assert SECRET not in everything(sink)


def test_only_the_listed_fields_are_copied_from_an_attempt():
    attempt = {"run_id": RUN, "application_id": "app-1", "broker_id": "b1", "attempt": 1, "provider": "gemini", "model": "m",
               "prompt_version": "v1", "started_at": "2026-11-07T10:00:00+00:00", "duration_s": 1.5, "outcome": "ok", "parsed_reply": {"a": 1},
               "headers": {"Authorization": "Bearer " + SECRET}, "api_key": SECRET, "search_links": ["https://x.example"]}
    _, doc = call_log.model_document("market", attempt, {"system": "s", "prompt": "p", "schema": {}})
    assert SECRET not in json.dumps(doc, default=str) and "headers" not in doc and "search_links" not in doc


# ---- a call is saved right away, and a save that fails twice fails the step --------------------------------------------


def test_each_attempt_is_saved_before_the_next_one_starts():
    order = []

    class Watching(MemorySink):
        def create(self, doc_id, doc):
            order.append(("saved", doc_id))
            super().create(doc_id, doc)

    class Network(tc.Providers):
        def __call__(self, url, headers, body, timeout):
            order.append(("sent", url.split("/")[2]))
            return super().__call__(url, headers, body, timeout)

    bad = {**tc.AFFORDABILITY, "rating": "not-a-rating"}
    providers = Network(ollama=bad)
    providers.replies["ollama.test"] = [bad, tc.AFFORDABILITY]
    run(providers=providers, sink=Watching())
    ollama = [event for event in order if event[0] == "sent" and "ollama" in event[1] or event == ("saved", f"{RUN}-affordability-1") or event == ("saved", f"{RUN}-affordability-2")]
    assert ollama == [("sent", "ollama.test:11434"), ("saved", f"{RUN}-affordability-1"), ("sent", "ollama.test:11434"), ("saved", f"{RUN}-affordability-2")]


def test_a_save_that_fails_once_is_tried_again_and_the_run_goes_on():
    sink = MemorySink(fail=1)
    record, sink, _ = run(sink=sink)
    assert record["status"] == "complete" and f"{RUN}-valuation_model-1" in sink.docs
    assert sink.attempts == len(sink.docs) + 1  # exactly one extra try


def test_a_save_that_fails_twice_fails_the_step_and_nothing_after_it_runs():
    class Down(MemorySink):
        def create(self, doc_id, doc):
            if "affordability" in doc_id:
                raise OSError("the store went away")
            super().create(doc_id, doc)

    providers = tc.Providers()
    record, sink, _ = run(sink=Down(), providers=providers)
    assert record["status"] == "failed" and record["failed_step"] == "affordability"
    assert "could not be logged" in record["failure_reason"] and "affordability-1" in record["failure_reason"]
    assert "generativelanguage" not in providers.hosts()  # the strategist never ran: the failed step stopped the run
    assert not any(key.startswith(f"{RUN}-strategist") for key in sink.docs)


def test_a_valuation_model_call_that_cannot_be_saved_fails_that_step():
    class Down(MemorySink):
        def create(self, doc_id, doc):
            if "valuation_model" in doc_id:
                raise OSError("the store went away")
            super().create(doc_id, doc)

    record, sink, providers = run(sink=Down())
    assert record["failed_step"] == "valuation_model" and "could not be logged" in record["failure_reason"]
    assert providers.calls == []  # no model was asked: the step order stops at the failed step


def test_a_run_without_a_sink_saves_nothing_and_behaves_as_before():
    deps = committee.Deps(
        store=tc.MemoryRunStore(), report_store=tc.a_report_for_today(), official=tc.OFFICIAL, benchmark_rate_pct=4.0, today=tc.TODAY,
        agents=tc.AGENTS, transport=tc.Providers(), env=tc.ENV, sleep=lambda s: None,
    )
    assert committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1")["status"] == "complete"


# ---- the sink and the saving -------------------------------------------------------------------------------------------


def test_saving_the_same_document_again_is_not_an_error_but_a_different_one_under_the_same_id_is():
    sink = MemorySink()
    call_log.save(sink, "run-x-market-1", {"a": 1})
    call_log.save(sink, "run-x-market-1", {"a": 1})  # an earlier try reached the store and only its answer was lost
    with pytest.raises(CallLogError, match="different call is already saved"):
        call_log.save(sink, "run-x-market-1", {"a": 2})
    assert sink.docs["run-x-market-1"] == {"a": 1}  # never replaced


def test_a_call_without_its_application_or_broker_cannot_be_saved():
    attempt = {"run_id": RUN, "attempt": 1, "provider": "gemini", "model": "m", "prompt_version": "v1", "outcome": "ok"}
    with pytest.raises(CallLogError, match="application_id, broker_id"):
        call_log.model_document("market", attempt, {})
