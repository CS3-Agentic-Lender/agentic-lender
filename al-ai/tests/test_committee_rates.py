"""The committee takes its rates from the ECB rate tool and never from a stand-in (AL-291). Fake rate cache, fake providers: no network, no Firestore."""

import json
from datetime import UTC, datetime, timedelta

import pytest

import test_committee as tc
from app import committee, official_rates, rates
from app import market_agent as ma

NOW = datetime(2026, 10, 23, 12, 0, tzinfo=UTC)


def deps_with(get_rate, providers=None, report_store=None, search=None):
    return committee.Deps(
        store=tc.MemoryRunStore(), report_store=report_store if report_store is not None else tc.a_report_for_today(), get_rate=get_rate,
        today=tc.TODAY, agents=tc.AGENTS, transport=providers or tc.Providers(), env=tc.ENV, sleep=lambda s: None,
        search=search or (lambda *a, **k: pytest.fail("no search should run")),
    )


def run(deps):
    return committee.run_committee(tc.MORTGAGE, deps=deps, application_id="app-1")


# ---- criterion 1: the calculations use the benchmark rate from the tool -------------------------------

def test_the_calculations_use_the_mortgage_rate_the_tool_gives_and_the_run_keeps_its_month():
    record = run(deps_with(tc.get_rate))
    out = record["steps"]["calculations"]["output"]
    assert (out["benchmark_rate_pct"], out["benchmark_rate_month"]) == (4.0, "2026-09")
    assert out["affordability_facts"]["benchmark_rate_pct"] == 4.0


def test_a_different_rate_from_the_tool_changes_the_calculations():
    other = dict(tc.RATES, mortgage_ie=rates.Rate("mortgage_ie", 5.5, "2026-09", 4.5, "2025-09", tc.FETCHED))
    record = run(deps_with(lambda name: other[name], report_store=_report_for(official_rates.load(lambda n: other[n], tc.TODAY).official)))
    assert record["steps"]["calculations"]["output"]["benchmark_rate_pct"] == 5.5
    assert record["steps"]["calculations"]["output"]["affordability_facts"]["benchmark_rate_pct"] == 5.5


def _report_for(official):
    store = ma.MemoryReportStore()
    store.put(ma.report_key(official, tc.TODAY), {
        "report_id": "market-test", "date": tc.TODAY, "official_figures_fingerprint": official.fingerprint(),
        "prompt_version": ma.PROMPT_VERSION, "provider": "gemini", "model": "gemini-3.1-flash-lite", "run_id": "earlier",
        "outlook": "stable", "summary": "Rates look steady.", "sources": [{"url": "https://ecb.example/hold", "date": "Oct 23, 2026"}],
    })
    return store


# ---- criterion 2: the Market & Macro agent gets both rates, dated, with their values a year earlier ------

def test_the_market_figures_are_both_rates_with_their_dates_and_their_values_12_months_earlier():
    figures = official_rates.load(tc.get_rate, tc.TODAY).official
    assert figures.as_of == tc.TODAY
    assert figures.figures == {
        "ecb_main_refinancing_rate_pct": 2.15, "ecb_main_refinancing_rate_year_earlier_pct": 3.65,
        "ie_new_mortgage_rate_pct": 4.0, "ie_new_mortgage_rate_year_earlier_pct": 4.5,
    }
    assert figures.observed == {
        "ecb_main_refinancing_rate_pct": "2026-06-11", "ecb_main_refinancing_rate_year_earlier_pct": "2025-06-11",
        "ie_new_mortgage_rate_pct": "2026-09", "ie_new_mortgage_rate_year_earlier_pct": "2025-09",
    }


def test_the_agent_is_shown_those_figures_with_their_dates():
    facts = ma.build_facts(official_rates.load(tc.get_rate, tc.TODAY).official, [], today=tc.TODAY)
    shown = facts["official_figures"]
    assert shown["ie_new_mortgage_rate_pct"] == 4.0 and shown["ie_new_mortgage_rate_year_earlier_pct"] == 4.5
    assert shown["observed"]["ecb_main_refinancing_rate_pct"] == "2026-06-11"


def test_a_series_with_no_value_a_year_back_gives_only_its_current_figure():
    short = dict(tc.RATES, ecb_mrr=rates.Rate("ecb_mrr", 2.15, "2026-06-11", None, None, tc.FETCHED))
    figures = official_rates.load(lambda name: short[name], tc.TODAY).official
    assert "ecb_main_refinancing_rate_year_earlier_pct" not in figures.figures and "ie_new_mortgage_rate_year_earlier_pct" in figures.figures


def test_the_run_record_shows_the_rates_the_run_used():
    record = run(deps_with(tc.get_rate))
    assert record["steps"]["market"]["rates"]["ie_new_mortgage_rate_pct"] == 4.0
    assert record["steps"]["market"]["rates"]["observed"]["ie_new_mortgage_rate_pct"] == "2026-09"


def test_a_changed_rate_date_makes_a_new_market_report():
    moved = dict(tc.RATES, mortgage_ie=rates.Rate("mortgage_ie", 4.0, "2026-10", 4.5, "2025-10", tc.FETCHED))
    assert official_rates.load(lambda n: moved[n], tc.TODAY).official.fingerprint() != tc.OFFICIAL.fingerprint()


def test_official_figures_dates_must_belong_to_a_figure():
    with pytest.raises(ValueError):
        ma.OfficialFigures(tc.TODAY, {"a_pct": 1.0}, {"b_pct": "2026-09"})


# ---- criterion 3: no rate, no run: and no model is called ------------------------------------------------

class Net:
    """A fake ECB that is down."""

    def __call__(self, url, headers, timeout):
        raise OSError("connection refused")


def cache_with(name, observed, fetched):
    cache = rates.MemoryCache()
    cache.save(name, rates.Rate(name, 3.9, observed, 4.2, "2025-01", fetched).to_doc())
    return cache


def through_the_tool(cache):
    return lambda name: rates.get_rate(name, cache=cache, transport=Net(), now=NOW)


def assert_stopped_by_the_rate(record, providers, name):
    assert record["status"] == "failed" and record["failed_step"] == "market"
    assert name in record["failure_reason"] and "calculations" not in record["steps"]
    assert providers.calls == [] and record["original_recommendation"] is None


def test_a_missing_rate_with_the_ecb_down_stops_the_run_naming_the_rate_and_calls_no_model():
    providers = tc.Providers()
    record = run(deps_with(through_the_tool(rates.MemoryCache()), providers))
    assert_stopped_by_the_rate(record, providers, "ecb_mrr")  # the first rate the step asks for
    assert "no cached ecb_mrr rate" in record["failure_reason"]


def test_a_rate_older_than_three_months_with_the_ecb_down_stops_the_run():
    cache = rates.MemoryCache()
    for name in ("ecb_mrr", "mortgage_ie"):
        cache.save(name, rates.Rate(name, 3.9, "2026-06", 4.2, "2025-06", NOW - timedelta(days=5)).to_doc())
    providers = tc.Providers()
    record = run(deps_with(through_the_tool(cache), providers))
    assert_stopped_by_the_rate(record, providers, "ecb_mrr")
    assert "more than 3 months old" in record["failure_reason"]


def test_the_benchmark_rate_missing_stops_the_run_naming_that_rate():
    cache = rates.MemoryCache()
    cache.save("ecb_mrr", rates.Rate("ecb_mrr", 2.15, "2026-06-11", 3.65, "2025-06-11", NOW).to_doc())
    providers = tc.Providers()
    record = run(deps_with(through_the_tool(cache), providers))
    assert_stopped_by_the_rate(record, providers, "mortgage_ie")


def test_a_recent_enough_cached_rate_is_used_when_the_ecb_is_down():
    cache = rates.MemoryCache()
    for name, observed in (("ecb_mrr", "2026-09-17"), ("mortgage_ie", "2026-09")):
        cache.save(name, rates.Rate(name, 4.0, observed, 4.5, "2025-09", NOW - timedelta(days=5)).to_doc())
    get_rate = through_the_tool(cache)
    record = run(deps_with(get_rate, report_store=_report_for(official_rates.load(get_rate, tc.TODAY).official)))
    assert record["steps"]["calculations"]["output"]["benchmark_rate_pct"] == 4.0


# ---- criterion 4: the local runner works with an injected cache -------------------------------------------

def test_the_local_runner_takes_its_rates_from_a_cache_file_and_never_asks_the_ecb(tmp_path, monkeypatch):
    cache_file = tmp_path / "rates.json"
    cache_file.write_text(json.dumps({
        name: {**rate.to_doc(), "fetchedAt": datetime.now(UTC).isoformat()} for name, rate in tc.RATES.items()
    }))
    seen = {}

    def fake_run(application, *, deps, application_id, **kw):
        seen["rates"] = official_rates.load(deps.get_rate, tc.TODAY)
        return {"status": "complete", "run_id": "r", "original_recommendation": "a", "effective_recommendation": "a", "failed_step": None}

    monkeypatch.setattr(committee, "run_committee", fake_run)
    monkeypatch.setattr(rates, "urllib_get", lambda *a, **k: pytest.fail("the cache is fresh, so the ECB must not be asked"))
    sample = committee.SAMPLES / "mortgage-application.json"
    assert committee.main([str(sample), "--rates", str(cache_file), "--out", str(tmp_path / "runs")]) == 0
    assert seen["rates"].benchmark_rate_pct == 4.0 and seen["rates"].benchmark_rate_month == "2026-09"


def test_no_stand_in_rate_or_sample_figures_file_is_left_in_the_live_path():
    import inspect

    from app import affordability_endpoint

    assert not (committee.SAMPLES / "official-figures.json").exists()
    assert not hasattr(committee, "DEFAULT_BENCHMARK_RATE_PCT")
    assert "BENCHMARK_RATE" not in inspect.getsource(affordability_endpoint) and "BENCHMARK_RATE" not in inspect.getsource(committee)
