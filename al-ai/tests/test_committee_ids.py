"""Every logged attempt of a run carries run_id, application_id and broker_id (AL-290). Fake providers: no network, no keys."""

import copy

import pytest

import test_committee as tc
from app import committee

IDS = ("run_id", "application_id", "broker_id")


def attempts_of(record):
    return [(name, attempt) for name, step in record["steps"].items() for attempt in step.get("attempts", [])]


def assert_every_attempt_carries_the_ids(record, expect_steps):
    found = attempts_of(record)
    assert {name for name, _ in found} >= expect_steps
    for name, attempt in found:
        assert attempt["run_id"] == record["run_id"], name
        assert attempt["application_id"] == record["application_id"] == "app-1", name
        assert attempt["broker_id"] == tc.MORTGAGE["brokerId"], name
        assert all(attempt[key] for key in IDS), name


def test_a_normal_run_logs_all_three_ids_on_every_attempt_of_every_model_step():
    record, _, _ = tc.go(tc.MORTGAGE)
    assert record["status"] == "complete"
    assert_every_attempt_carries_the_ids(record, {"affordability", "valuation_agent", "strategist"})


def test_a_failed_run_still_logs_the_ids_on_the_attempts_it_made():
    record, _, _ = tc.go(tc.MORTGAGE, tc.Providers(ollama=(503, b"down")))
    assert record["status"] == "failed" and record["failed_step"] == "affordability"
    assert len(record["steps"]["affordability"]["attempts"]) == 3
    assert_every_attempt_carries_the_ids(record, {"affordability", "valuation_agent"})


def test_a_re_run_logs_the_ids_under_its_own_run_id():
    failed, _, _ = tc.go(tc.MORTGAGE, tc.Providers(ollama=(503, b"down")))
    deps = committee.Deps(
        store=tc.MemoryRunStore(), report_store=tc.a_report_for_today(), get_rate=tc.get_rate, today=tc.TODAY,
        agents=tc.AGENTS, transport=tc.Providers(), env=tc.ENV, sleep=lambda s: None,
    )
    again = committee.rerun_committee(failed, tc.MORTGAGE, deps=deps)
    assert again["rerun_of"] == failed["run_id"] and again["run_id"] != failed["run_id"]
    assert_every_attempt_carries_the_ids(again, {"affordability", "valuation_agent", "strategist"})


def test_the_valuation_model_step_and_the_record_carry_the_ids_as_well():
    record, _, _ = tc.go(tc.MORTGAGE)
    step = record["steps"]["valuation_model"]
    assert {key: step[key] for key in IDS} == {"run_id": record["run_id"], "application_id": "app-1", "broker_id": tc.MORTGAGE["brokerId"]}
    assert record["broker_id"] == tc.MORTGAGE["brokerId"]
    assert all(call["application_id"] == "app-1" and call["broker_id"] == tc.MORTGAGE["brokerId"] for call in record["ai_calls"])


@pytest.mark.parametrize("missing", ["no key", "empty"])
def test_an_application_without_a_broker_fails_at_validate_and_logs_no_call(missing):
    bad = copy.deepcopy(tc.MORTGAGE)
    if missing == "no key":
        del bad["brokerId"]
    else:
        bad["brokerId"] = ""
    record, providers, store = tc.go(bad)
    assert record["status"] == "failed" and record["failed_step"] == "validate"
    assert "brokerId" in record["failure_reason"]
    assert providers.calls == [] and attempts_of(record) == [] and record["ai_calls"] == [] and store.saved == [record]


def test_the_heloc_sample_has_a_broker_too():
    record, _, _ = tc.go(tc.HELOC)
    assert record["status"] == "complete"
    assert all(attempt["broker_id"] == tc.HELOC["brokerId"] for _, attempt in attempts_of(record))


def test_the_market_step_hands_the_ids_to_each_web_search():
    from app import market_agent as ma
    from app import serper

    seen = []

    def fake_search(query, **kw):
        seen.append(kw.get("context"))
        return serper.SearchResult(query, (serper.Hit("ECB holds", "https://ecb.example/hold", "Rates held.", "Oct 23, 2026"),), 0.1, 1)

    deps = committee.Deps(
        store=tc.MemoryRunStore(), report_store=ma.MemoryReportStore(), get_rate=tc.get_rate, today=tc.TODAY,
        agents=tc.AGENTS, transport=tc.Providers(), env=tc.ENV, sleep=lambda s: None, search=fake_search,
    )
    record = committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1")  # the fake Gemini cannot write a report; the searches still ran
    expected = {"run_id": record["run_id"], "application_id": "app-1", "broker_id": tc.MORTGAGE["brokerId"]}
    assert seen and all(context == expected for context in seen)
    assert all({key: s[key] for key in expected} == expected for s in record["steps"]["market"].get("searches", []))
