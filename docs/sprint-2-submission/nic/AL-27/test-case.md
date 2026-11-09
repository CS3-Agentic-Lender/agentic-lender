# Test case: AL-27

As an underwriter, a market research agent pulls current central bank rates and mortgage trends

| Item | Detail |
|---|---|
| Story | AL-27: As an underwriter, a market research agent pulls current central bank rates and mortgage trends |
| Epic | AL-7 AI Credit Committee |
| Owner | Nic (al-ai: the market agent and the rate wiring). Dumi wrote the ECB rate tool (`rates.py`). |
| Sprint | Sprint 2 (27 Oct to 15 Nov 2026) |
| Wireframe | wireframe.png in this folder. AL-27 has no screen, so it is a flow diagram. |
| Code | `al-ai/app/market_agent.py`, `al-ai/app/serper.py`, `al-ai/app/rates.py`, `al-ai/app/committee.py` and `al-ai/app/prompts/market_agent_v1.md`, on `main` at commit `86cd8d4` |
| Tested by | Nicholas Groenewald, 9 Nov 2026 |

## What this tests

Code gets two official rates from the ECB and caches them, and the run stops if it can't get a rate it trusts. The market agent then searches the web with Serper and writes a short outlook on Gemini, which the code checks before keeping it. These tests check the rates, the stop rules, the agent's reply, report reuse and logging.

## Wireframe

![Flow diagram](wireframe.png)

## Preconditions and test data

- I installed the `al-ai` dependencies (`cd al-ai && uv sync`).
- The automated tests use a fake ECB, a fake Serper, a fake Gemini and an in-memory or fake Firestore, so they need no keys and no network.
- A live run (criteria 3 and 4 by hand) needs `GEMINI_API_KEY` and `SERPER_API_KEY` in the repo-root `.env`.
- I made no live calls for this test.

## Test cases

| ID | Acceptance criterion | Steps | Expected result | How it was checked, and the result |
|---|---|---|---|---|
| TC-27-01 | A code tool fetches the ECB main refinancing rate and the Irish benchmark mortgage rate (MIR.M.IE.B.A2C.A.R.A.2250.EUR.P), now and 12 months earlier, with dates, and caches them in Firestore. | 1. Run `cd al-ai && uv run python -m app.rates` against the Firestore emulator. 2. Open `rates_cache/ecb_mrr` and `rates_cache/mortgage_ie` in the Emulator UI. 3. Call it again. | Each document has `ratePct`, `observed`, `yearEarlierPct`, `yearEarlierObserved` and `fetchedAt`, and a second call within a day reads the cache instead of the ECB. | Automated: `test_rates.py`: `test_the_mortgage_rate_is_the_latest_month_with_the_month_a_year_earlier`, `test_the_refinancing_rate_is_the_latest_change_and_the_rate_in_force_a_year_earlier`, `test_the_request_names_the_series_and_how_far_back_to_look`, `test_a_rate_fetched_less_than_a_day_ago_comes_from_the_cache_without_asking_the_ecb`, `test_an_empty_cache_fetches_and_keeps_the_result_with_its_dates`, `test_the_firestore_cache_keeps_one_document_per_rate_in_rates_cache`; `test_committee_rates.py`: `test_the_market_figures_are_both_rates_with_their_dates_and_their_values_12_months_earlier`. **Pass.** |
| TC-27-02 | If the official data can't be fetched or is more than 3 months old, the run fails with that reason. No rate is made up or taken from LLM text. | 1. Make the ECB unreachable. 2. Run the committee with an empty cache. 3. Run it again with a cached rate from June 2026. | The run is saved as failed at the market step, the reason names the rate and no model is called. | Automated: `test_rates.py`: `test_a_reply_we_cannot_use_raises_with_the_reason_and_returns_no_number`, `test_the_cutoff_is_three_calendar_months`, `test_if_the_fetch_fails_and_the_cached_observation_is_too_old_the_error_carries_both_reasons_and_no_number`, `test_if_the_fetch_fails_and_nothing_is_cached_there_is_no_rate_to_return`; `test_committee_rates.py`: `test_a_missing_rate_with_the_ecb_down_stops_the_run_naming_the_rate_and_calls_no_model`, `test_a_rate_older_than_three_months_with_the_ecb_down_stops_the_run`, `test_the_benchmark_rate_missing_stops_the_run_naming_that_rate`, `test_no_stand_in_rate_or_sample_figures_file_is_left_in_the_live_path`. The tests pass. **Partly met:** the 3-month check only happens when the ECB is down (see Notes). |
| TC-27-03 | The agent on Gemini uses Serper search and returns JSON that passes the schema check: outlook (rising / stable / falling), a short summary and dated source links. It gets no borrower data and has no vote. | 1. Run `cd al-ai && uv run python -m app.market_agent` (real Serper and Gemini, made-up official figures; manual, not run in this test). 2. Read the saved evidence in `al-ai/docs/market-agent-runs.json` (28 Oct 2026). | The report has `outlook`, `summary` and 1 to 5 dated `sources` from the search results. The prompt holds only the official figures and search results. The strategist's votes are Affordability and Valuation only. | Automated: `test_market_agent.py`: `test_a_good_reply_passes`, `test_a_reply_with_a_bad_field_is_rejected`, `test_a_reply_with_the_wrong_fields_is_rejected`, `test_a_summary_that_quotes_a_figure_it_was_not_given_is_rejected`, `test_a_run_searches_then_asks_the_configured_model_once_and_stores_a_report`, `test_the_facts_hold_the_official_figures_and_numbered_results_and_nothing_about_a_borrower`, `test_the_model_is_sent_the_data_and_no_borrower_details`, `test_the_agent_is_the_one_agents_json_names_for_market`, `test_a_model_that_obeys_the_injection_is_rejected_and_the_report_is_not_stored`; `test_strategist_agent.py`: `test_the_agents_that_disagree_are_worked_out_by_code`. Live run not done in this test. **Pass.** |
| TC-27-04 | The LLM report is reused within the same day unless the official figures change, and each run records the ID of the report it used. | 1. Run the market step twice on the same day with the same figures. 2. Run it once more with a changed rate. | The second run calls no search or model and records `reused_report_id`, the changed rate makes a new report and the run record keeps `steps.market.report_id`. | Automated: `test_market_agent.py`: `test_the_same_day_and_the_same_figures_reuse_the_report_and_call_nothing`, `test_changed_official_figures_make_a_new_report`, `test_a_new_day_makes_a_new_report`; `test_committee_rates.py`: `test_a_changed_rate_date_makes_a_new_market_report`, `test_the_run_record_shows_the_rates_the_run_used`. Recorded run: `al-ai/docs/committee-evidence/mortgage-run.json` has `report_id` `market-2026-11-04-bbb15157b172`. **Pass.** |
| TC-27-05 | Every Serper search and LLM call is logged with its query or prompt version, results, timing and outcome. | 1. Run the committee. 2. Read the `ai_calls` collection in the Emulator UI. | There is one `ai_calls` document per search and per model attempt. | Automated (log lines only): `test_market_agent.py`: `test_every_model_call_is_logged_with_prompt_version_links_duration_and_outcome_and_never_the_key`, `test_every_search_is_recorded_with_the_ids_it_ran_under_whether_it_worked_or_not`; `test_serper.py`: `test_every_query_is_logged_with_its_outcome_and_links_and_never_the_key`, `test_a_query_is_logged_with_the_run_and_prompt_version_that_asked_for_it`. **Not met yet:** it needs PR #177 (saving every call as an `ai_calls` document), which isn't merged into `main`. |

## Test run

From `al-ai` on `main` at `86cd8d4`, 9 Nov 2026: `uv run pytest -q -p no:cacheprovider tests/test_rates.py tests/test_committee_rates.py tests/test_market_agent.py tests/test_serper.py tests/test_strategist_agent.py tests/test_committee.py`

**188 passed, 0 failed, 2 skipped.** The two skipped are the live tests `test_live_a_real_search_and_the_configured_model_make_a_checked_report` (`test_market_agent.py`) and `test_live_the_configured_strategist_writes_a_checked_memo` (`test_strategist_agent.py`). They only run with `AL_LIVE_LLM=1` and real keys. None of these tests need the Firestore emulator, because the Firestore cache is tested with a fake client.

## Notes

- **Criterion 2 gap.** `rates.get_rate` only checks the 3-month limit when the ECB can't be reached and it falls back to the cache.
  - If the ECB answers but its latest value is already over 3 months old, the rate is accepted.
  - I checked this with a fake ECB reply whose latest month was 2026-05, on 9 Nov 2026. `get_rate` returned 3.9 from 2026-05 with no error.
  - No test covers this case. The monthly MIR series usually lags by a month or two, so it could matter in practice.
- **Criterion 4, where reports are kept.** Reports are stored in `MemoryReportStore`, which the committee runner and the Firestore listener (`committee.local_deps`) both use.
  - Reuse works inside one running process, but it isn't shared between processes or kept after a restart.
  - The two recorded runs on 4 Nov have the same `report_id`, but `reused_report_id` is null on both, because each was its own process.
- **Criterion 5.** The logging itself exists. Every search (`al-ai.serper`) and model attempt (`al-ai.market-agent`) goes to the log as JSON with the run ID, prompt version, links or reply, `duration_s` and outcome. The run record also keeps `searches` and `attempts`.
  - What's missing is the saved `ai_calls` collection from PR #177.
  - The `searches` entries in the run record don't have a duration. Only the log line does.
- The recorded committee runs in `al-ai/docs/committee-evidence/` are from 4 Nov. That's before the rates were wired in from the ECB tool (8 Nov), so they don't show `steps.market.rates`. A fresh run would.
- The saved `market-agent-runs.json` (28 Oct) used made-up official figures. Its source dates are as Serper gave them ("2 days ago"). The code now rewrites those to ISO dates.
- Dumi wrote the ECB rate tool (`rates.py`). My work on this story is the agent step and the wiring.
