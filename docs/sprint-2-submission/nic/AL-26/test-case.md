# Test case: AL-26

As an underwriter, a valuation agent flags overvalued collateral and computes LTV

| Item | Detail |
|---|---|
| Story | AL-26: As an underwriter, a valuation agent flags overvalued collateral and computes LTV |
| Epic | AL-7 AI Credit Committee |
| Owner | Nic (al-ai: the valuation checks and the valuation agent) |
| Sprint | Sprint 2 (27 Oct to 15 Nov 2026) |
| Wireframe | wireframe.png in this folder. AL-26 has no screen, so it is a flow diagram. |
| Code | `al-ai/app/valuation_checks.py`, `al-ai/app/valuation_agent.py`, `al-ai/app/prompts/valuation_agent_v2.md` and `al-ai/app/llm/agents.json`, on `main` at commit `86cd8d4` |
| Tested by | Nicholas Groenewald, 9 Nov 2026 |

## What this tests

Code works out the price gap, the "price needs review" flag and both LTVs, so the numbers never come from the LLM. The agent then explains those results and gives a recommendation. These tests check the maths, the edge cases and that the agent's reply is checked before it's used.

## Wireframe

![Flow diagram](wireframe.png)

## Preconditions and test data

- I installed the `al-ai` dependencies with `uv` (`cd al-ai && uv sync`). The saved valuation model is in `al-ai/models`.
- The automated tests need no API keys and no network, because the agent step uses a fake network.
- `AL_LIVE_LLM` isn't set, so the live test skips.
- The manual live run (criteria 4 and 5) needs a Groq key in `al-ai/.env` as `GROQ_API_KEY`.

## Test cases

| ID | Acceptance criterion | Steps | Expected result | How it was checked, and the result |
|---|---|---|---|---|
| TC-26-01 | Code works out the signed gap (asking price / estimate - 1) and flags the price for review when the gap is above the threshold. Exactly at the threshold doesn't count. | 1. Call `check_valuation` with the gap exactly at the threshold. 2. Call it again with the gap just above. | `needs_review` is false at the threshold and true just above it. | Automated: `test_valuation_checks.py`: `test_the_gap_is_signed_asking_over_estimate_minus_one`, `test_a_gap_exactly_at_the_threshold_does_not_trigger_review`, `test_a_gap_just_above_the_threshold_triggers_review`. `test_valuation_shared_gap.py`: `test_a_gap_exactly_at_the_threshold_does_not_trigger_review_and_just_above_does`, `test_through_the_endpoint_a_gap_exactly_at_the_threshold_does_not_trigger_review`, `test_check_valuation_takes_the_gap_and_the_flag_from_the_same_shared_function`. **Pass.** |
| TC-26-02 | Code works out purchase LTV and model LTV and checks each against the 90% limit. | 1. Call `check_valuation` with a loan at exactly 90% and just over. 2. Try an asking price above and below the estimate. | Purchase LTV is loan / asking price, model LTV is loan / the lower of asking price and estimate, and both are fine at 90% but over the limit just above. | Automated: `test_valuation_checks.py`: `test_purchase_price_ltv_is_loan_over_asking_price`, `test_model_ltv_uses_the_lower_of_asking_price_and_estimate`, `test_an_ltv_of_exactly_90_percent_is_within_the_limit`, `test_an_ltv_just_above_90_percent_is_over_the_limit`, `test_the_two_ltvs_can_disagree`. **Pass.** |
| TC-26-03 | Tests cover a gap at the threshold, an asking price below the estimate, LTV at exactly 90% and a low-support warning. | 1. Run the tests for the four named cases. | No flag at the threshold, a negative gap and no flag for a lower asking price, 90% is within the limit and the warning reaches the agent unchanged. | Automated: `test_valuation_checks.py`: `test_a_gap_exactly_at_the_threshold_does_not_trigger_review`, `test_an_asking_price_below_the_estimate_is_never_flagged`, `test_an_ltv_of_exactly_90_percent_is_within_the_limit`, `test_support_warnings_are_passed_through_unchanged`. `test_valuation_agent.py`: `test_the_support_warnings_are_passed_through_unchanged`. `test_valuation_shared_gap.py`: `test_through_the_endpoint_an_asking_price_below_the_estimate_is_a_negative_gap_and_no_flag`. **Pass.** |
| TC-26-04 | The agent on Mistral (Groq backup, switched by hand) returns JSON that passes the schema check: rating, recommendation, concerns and suggested conditions. | 1. Give the agent step the facts from `build_facts`. 2. Feed it fake good and bad replies. 3. Live (manual, not run in this test): `cd al-ai && uv run python -m app.valuation_agent`. | Only a reply with `rating`, `recommendation` (Approve / Conditionally Approve / Decline), `conditions` and `explanation` passes. A bad reply gets one retry then the step fails. Approve is refused over a flag or an LTV over the limit. The model only comes from `agents.json`. | Automated: `test_valuation_agent.py`: `test_a_good_reply_passes`, `test_a_reply_with_a_bad_field_is_rejected`, `test_a_reply_with_the_wrong_fields_is_rejected`, `test_a_reply_cannot_recommend_approve_when_the_code_says_the_price_needs_review`, `test_a_reply_cannot_recommend_approve_when_a_loan_to_value_is_over_the_limit`, `test_two_bad_replies_in_a_row_fail_the_step_with_the_reason_and_no_other_model_is_used`, `test_the_step_uses_the_valuation_agent_from_the_config_by_default`. `test_llm_config.py`: `test_the_valuation_agent_runs_on_groq_and_its_manual_backup_is_gemini_flash_lite`, `test_mistral_is_not_named_anywhere_in_the_agents_config`. The tests pass. Live run not done in this test. **Not met as worded:** the code uses a different model and different reply fields (Notes 1 and 2). |
| TC-26-05 | The report calls the model figure "indicative" and never a verified valuation. | 1. Read the prompt rule. 2. Read the saved real runs in `al-ai/docs/valuation-agent-runs.json`. 3. Live (manual, not run in this test): `cd al-ai && uv run python -m app.valuation_agent`. | The report says the figure is indicative and never calls it a verified valuation. | No automated test checks the wording. **Partly met:** it's a rule in the prompt only, not checked in code (Note 3). |

## Test run

From `al-ai` on `main` at `86cd8d4`, 9 Nov 2026: `uv run pytest -q -p no:cacheprovider tests/test_valuation_checks.py tests/test_valuation_shared_gap.py tests/test_valuation_agent.py tests/test_llm_config.py tests/test_groq_decision_recorded.py`

**132 passed, 1 skipped.** The skipped one is `test_live_the_configured_valuation_agent_answers_a_made_up_application`, which only runs with `AL_LIVE_LLM=1` because it makes a real Groq call. I made no live model call for this test case.

## Notes

1. **Model.** The criterion says Mistral with Groq as the backup. The code runs the agent on Groq `openai/gpt-oss-120b`, with Gemini `gemini-3.1-flash-lite` as the manual backup (`al-ai/app/llm/agents.json`).
   - We dropped Mistral on 28 Oct because it has no free API tier. The team agreed in `#announcements` and it's recorded in `docs/infrastructure.md` (PR #124).
   - The "switched by hand, never automatically" part still holds. The backup is only used when a person edits `agents.json`.
2. **Reply fields.** The criterion asks for a rating of fair / slightly high / needs review and a list of concerns. The code is different:
   - `rating` is `strong`, `adequate`, `weak` or `unsupported`. It rates the collateral, not the price.
   - There's `conditions` and a free-text `explanation`, but no separate `concerns` field.
   - The price judgement is the code's `price_needs_review` flag, and the agent can't clear it.
   - Conditions like an independent surveyor's valuation are allowed. They show up in all three saved real runs.
3. **"Indicative".** The prompt (`al-ai/app/prompts/valuation_agent_v2.md`) tells the model the estimate "is an indicative estimate and not a surveyor's valuation". The three saved real runs (Groq, Gemini, Ollama) all say this. But `check_reply` doesn't require the word or reject "verified valuation", so a reply that leaves it out would still pass.
4. The HELOC path (combined LTV against 80%) is part of the same step and is tested in `test_valuation_agent.py`, but it's outside this story's criteria.
