# Test case: AL-130

As an underwriter, the credit committee runs end to end on each application and saves one run record

| Item | Detail |
|---|---|
| Story | AL-130: As an underwriter, the credit committee runs end to end on each application and saves one run record |
| Epic | AL-7 AI Credit Committee |
| Owner | Nic (al-ai: the committee flow and auto-start) |
| Sprint | Sprint 2 (27 Oct to 15 Nov 2026) |
| Wireframe | `wireframe.png` in this folder. AL-130 has no screen, so it is a flow diagram. |
| Code | `al-ai/app/committee.py`, `al-ai/app/auto_start.py`, `al-ai/app/retry_policy.py`, `al-ai/app/call_log.py` and `al-core/firestore.rules`, on `main` at commit `d1d1014` |
| Tested | 13 Nov 2026, Nicholas Groenewald |

## What this tests

The committee runs its steps in a fixed order and saves one record per run. A step that keeps failing ends the run as failed with no recommendation, and a failed run can be re-run. When an application becomes Applied the run starts by itself, and a finished run moves it to AI Deliberated. Every call the run makes is saved in `ai_calls`.

## Wireframe

![Flow diagram](wireframe.png)

## Preconditions and test data

- The `al-ai` dependencies are installed with `uv` (`cd al-ai && uv sync`). The saved valuation model is in `al-ai/models`.
- No API keys and no network are needed. The tests use fake Gemini, Groq and Ollama replies and a fake ECB rate cache.
- Test data is the made-up applications in `al-ai/app/committee_samples/` (one mortgage, one HELOC).
- Some tests need the Firestore emulator. They skip without it.
- A live run (real models and Serper) was not made for this test case.

## Test cases

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-130-01 | The flow runs validate, valuation model, Market & Macro, code calculations, the affordability and valuation agents, strategist, policy gate, then save. Each step's input and output is kept in the run state. | 1. Run the committee on the mortgage sample. 2. Check the step order and the step results. | The steps run in that order, with the two agents side by side, and every step has a result. | Pass. `test_committee.py`: `test_the_nodes_run_in_the_ticket_order_with_the_two_agents_side_by_side`, `test_the_run_state_holds_every_steps_result`, `test_the_strategist_is_given_both_agents_reports`. |
| TC-130-02 | The local runner, given a made-up application, saves one run record with a run ID, every step's result, the original and effective recommendation and a link to every logged call. | 1. Run the committee with fakes and read the record. 2. Run the local runner with a rates file. | One record per run with a new run ID, every step, both recommendations and one call ID per logged call. | Pass. `test_committee.py`: `test_a_run_saves_one_record_with_a_unique_run_id_and_the_fields_from_the_ticket`, `test_the_record_lists_a_call_id_for_every_logged_attempt`. `test_committee_rates.py`: `test_the_local_runner_takes_its_rates_from_a_cache_file_and_never_asks_the_ecb`. No live run (Note 1). |
| TC-130-03 | If a required step still fails after its retries, the run is saved as failed with the step and reason and no recommendation. A re-run gets a new run ID linked to the failed one. | 1. Make a fake provider keep failing. 2. Re-run the failed record. | The run is saved as failed with the step and reason and no recommendation. The re-run has a new run ID that points back to the failed run. | Pass. `test_committee.py`: `test_a_step_that_fails_after_its_retries_saves_a_failed_run_with_no_recommendation`. `test_retry_budget.py`: `test_a_provider_error_is_retried_at_most_twice_after_2_then_8_seconds`, `test_a_re_run_has_a_new_run_id_linked_to_the_failed_run_and_leaves_the_failed_record_alone`. Nothing in the app triggers a re-run yet (Note 2). |
| TC-130-04 | When an application moves to Applied the committee starts in the background. The AI run status is stored apart from the application status, and a complete run moves the application to AI Deliberated. | 1. On the emulator, set an application to Applied with the listener running. 2. Finish one run as complete and one as failed. | One run starts. A complete run moves the application to AI Deliberated. A failed run leaves it at Applied. | Pass, with the emulator. `test_auto_start.py`: `test_two_claims_at_the_same_moment_have_exactly_one_winner`, `test_a_complete_run_moves_the_application_to_ai_deliberated_with_a_status_history_entry`, `test_a_failed_run_leaves_the_application_applied_with_no_history_entry_and_the_reason_on_the_run`, `test_the_listener_starts_a_run_when_an_application_becomes_applied_and_only_one`. The listener only runs when `AUTO_START_COMMITTEE=true` (Note 3). |
| TC-130-05 | Every LLM call, Serper search and valuation-model call is saved as one record in an `ai_calls` collection that underwriters can read, and brokers only for their own clients. | 1. Run a whole committee run with fakes and list the saved documents. 2. Read the Firestore rules for `ai_calls`. | One `ai_calls` document per call, each retry its own document. Underwriters can read all, a broker only where `brokerId` is theirs. | Pass for the saving. `test_call_log.py`: `test_a_complete_run_saves_one_document_for_each_call_and_they_line_up_with_the_run_record`, `test_every_retry_is_its_own_document_and_shows_what_was_sent_the_second_time`, `test_the_valuation_model_call_is_saved_with_its_inputs_and_answer`. `test_call_log_firestore.py`: `test_a_whole_committee_run_leaves_its_calls_where_the_run_can_be_found`. The access rule is in `firestore.rules`. I did not run its test (Note 4). |

## Test run

From `al-ai` on `main` at `d1d1014`, 13 Nov 2026:

`uv run pytest -q -p no:cacheprovider tests/test_committee.py tests/test_retry_budget.py tests/test_committee_ids.py tests/test_budget_before_first_call.py tests/test_committee_rates.py tests/test_auto_start.py tests/test_auto_start_wiring.py tests/test_call_log.py tests/test_call_log_firestore.py`

Result without the emulator: 83 passed, 67 skipped. The skips are the tests in `test_auto_start.py` and `test_call_log_firestore.py` that need Firestore.

Result with the Firestore emulator running (`firebase emulators:exec --only firestore --project demo-al --config firebase.json`, run from `al-core`), on `test_auto_start.py`, `test_auto_start_wiring.py` and `test_call_log_firestore.py`: 72 passed, 0 skipped.

No run called a real model, Serper or the ECB.

## Notes

1. I made no live run, because it calls Gemini, Groq, Ollama and Serper. The live evidence is the two run records from 4 Nov 2026 in `al-ai/docs/committee-evidence/` (mortgage: Approve to Approve, HELOC: Approve to Conditionally Approve). The runner test swaps `run_committee` for a fake, so it checks the runner's setup and not a whole run.
2. `rerun()` works in the tests, but nothing in the app calls it, because we haven't decided what triggers a re-run. The local runner can re-run with `--rerun <failed run id>`. The criterion only says a re-run gets a new linked ID, so it is met as worded.
3. The listener is off by default. It starts only when the service runs with `AUTO_START_COMMITTEE=true`.
4. The access rule for `ai_calls` is tested in `al-core/test/rules.test.js` (Dumi's work). I read the rule but did not run that test for this document. The `ai_calls` collection comes from Dumi's PR #177, merged on 10 Nov, after the first version of this test case.
