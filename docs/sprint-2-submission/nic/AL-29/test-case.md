# Test case: AL-29

As a developer, the agents run on two cloud LLM APIs plus a local Ollama model

| Item | Detail |
|---|---|
| Story | AL-29: As a developer, the agents run on two cloud LLM APIs plus a local Ollama model |
| Epic | AL-7 AI Credit Committee |
| Owner | Nic (al-ai: the provider clients and the model config) |
| Sprint | Sprint 2 (27 Oct to 15 Nov 2026) |
| Wireframe | wireframe.png in this folder. AL-29 has no screen, so it is a flow diagram. |
| Code | `al-ai/app/llm/agents.json`, `al-ai/app/llm/config.py`, `al-ai/app/llm/clients.py` and `al-ai/app/llm/smoke.py`, on `main` at commit `86cd8d4` |
| Tested by | Nicholas Groenewald, 9 Nov 2026 |

## What this tests

One config file pins each agent to an exact model, and there's one small client per provider. Nothing switches model on its own. These tests check the config, the smoke test, a real committee run on three models and that a dead Ollama fails instead of falling back to the cloud.

## Wireframe

![Flow diagram](wireframe.png)

## Preconditions and test data

- I installed the `al-ai` dependencies (`cd al-ai && uv sync`).
- The automated tests use a fake network for every provider, so they need no keys and no Ollama.
- A live run needs `GEMINI_API_KEY` and `GROQ_API_KEY` in the repo-root `.env` and `ollama serve` running with `qwen3.5:9b` pulled.
- I made no live calls for this test. Criteria 2 and 3 use evidence already saved in the repo.

## Test cases

| ID | Acceptance criterion | Steps | Expected result | How it was checked, and the result |
|---|---|---|---|---|
| TC-29-01 | One config maps each agent to a provider and an exact pinned model: Market & Macro and Strategist on Gemini, Valuation on Mistral Small 4 (Groq gpt-oss-120b as the backup, switched by hand, never automatically), Affordability on Ollama. | 1. Open `al-ai/app/llm/agents.json`. 2. Run the config tests. | Market & Macro and Strategist: `gemini` `gemini-3.1-flash-lite`. Valuation: `groq` `openai/gpt-oss-120b`, manual backup `gemini` `gemini-3.1-flash-lite`. Affordability: `ollama` `qwen3.5:9b`. No moving aliases and no fallback section. | Automated: `test_llm_config.py`: `test_the_real_config_loads_and_pins_a_model_for_every_agent`, `test_no_model_in_the_real_config_is_a_moving_alias`, `test_the_valuation_agent_runs_on_groq_and_its_manual_backup_is_gemini_flash_lite`, `test_a_bad_config_is_refused`, `test_every_agent_in_the_real_config_reaches_the_provider_it_names_and_only_that_one`; `test_groq_decision_recorded.py` (every test in the file). **Pass**, against the team decision of 28 Oct 2026: Valuation is on Groq, not Mistral (see Notes). |
| TC-29-02 | A schema smoke test passes for each provider before the committee uses it, and the exact Gemini and Ollama model IDs go into `docs/infrastructure.md` when it does. | 1. Live (manual, not run in this test): `cd al-ai && uv run python -m app.llm.smoke`. 2. Read `al-ai/docs/llm-smoke-results.json`. 3. Read the "Smoke test (27 Oct 2026)" entry in `docs/infrastructure.md`. | Each provider in use answers the tiny structured request with `{"answer": 4}`. | Automated: `test_llm_smoke.py`: `test_a_provider_with_no_key_is_skipped_not_failed`, `test_a_working_provider_is_recorded_as_passed_with_its_details`, `test_a_wrong_answer_is_a_fail_even_if_the_schema_passes`, `test_the_saved_evidence_never_contains_a_key`; `test_llm_config.py`: `test_each_provider_in_use_has_one_model_to_smoke_test`. Recorded evidence: `llm-smoke-results.json` shows a pass on 27 Oct 2026 for Gemini `gemini-3.1-flash-lite`, Ollama `qwen3.5:9b` and Groq `openai/gpt-oss-120b` (Mistral skipped, no key), and `docs/infrastructure.md` records those IDs. **Pass** (from the recorded evidence; I didn't re-run the live smoke test). |
| TC-29-03 | One end-to-end committee run's log shows real calls to Gemini, Mistral and Ollama, each with its exact model ID, and the three voting agents use three different models. | 1. Live (manual, not run in this test): `cd al-ai && uv run python -m app.committee app/committee_samples/mortgage-application.json`. 2. Read the saved record `al-ai/docs/committee-evidence/mortgage-run.json`. | The 4 Nov 2026 record shows `market` and `strategist` on `gemini` `gemini-3.1-flash-lite`, `valuation_agent` on `groq` `openai/gpt-oss-120b` and `affordability` on `ollama` `qwen3.5:9b`, all with outcome `ok`. That's three models for the three agents that feed the decision. | Automated (fake network): `test_committee.py`: `test_each_agent_calls_the_provider_agents_json_gives_it`. Recorded evidence: `mortgage-run.json` and `heloc-run.json` in `al-ai/docs/committee-evidence/`. **Pass** (from the recorded 4 Nov run, with Groq instead of Mistral; not re-run live). |
| TC-29-04 | On a machine that can't run Ollama, the affordability step fails instead of quietly using a cloud model. | 1. Stop Ollama (or point `OLLAMA_HOST` at a dead address) with the cloud keys set. 2. Run the committee. | The affordability step fails after its retries, which all go to Ollama. The run is saved as failed and nothing goes to Gemini, Groq or Mistral. | Automated: `test_ollama_no_fallback.py`: `test_an_unreachable_ollama_fails_the_affordability_step_and_no_cloud_model_is_called`, `test_the_same_holds_when_no_ollama_address_is_set_and_the_default_local_one_is_unreachable`, `test_a_committee_run_with_ollama_down_is_saved_as_failed_and_the_affordability_prompt_goes_nowhere_else`; `test_llm_clients.py`: `test_a_rate_limit_is_an_error_and_there_is_no_fallback_to_another_provider`. **Pass.** |

## Test run

From `al-ai` on `main` at `86cd8d4`, 9 Nov 2026: `uv run pytest -q -p no:cacheprovider tests/test_llm_config.py tests/test_llm_clients.py tests/test_llm_smoke.py tests/test_ollama_no_fallback.py tests/test_groq_decision_recorded.py tests/test_committee.py`

**122 passed, 0 failed, 4 skipped.** The four skipped are `test_live_provider_answers_the_tiny_structured_request` in `test_llm_smoke.py`, one per provider. They only run with `AL_LIVE_LLM=1` and real keys. None of these tests need the Firestore emulator.

## Notes

- **Mistral was replaced by Groq.** Criteria 1 and 3 name Mistral Small 4. On 28 Oct 2026 the team agreed to run the valuation agent on Groq `openai/gpt-oss-120b` instead, because Mistral has no free API tier. It's recorded in `docs/infrastructure.md`.
  - The manual backup is Gemini `gemini-3.1-flash-lite`, switched by editing `agents.json`. The code never falls back on its own.
  - Mistral is still a supported provider in `clients.py`, but the config doesn't name it.
  - So the two cloud APIs are now Gemini and Groq.
- **Criterion 2, "before the committee uses it".** The smoke test is a script a person runs (`app.llm.smoke`). The committee doesn't run it or check its result before a run. The recorded pass is from 27 Oct 2026, before the first committee runs on 4 Nov.
- **Criterion 3, "log".** The evidence is the saved run record, where each step lists its attempts with provider, model, prompt version and outcome. The model in each attempt is the one the config asked for. The provider's own model name isn't saved separately.
- In `heloc-run.json` the market and strategist steps each had one `provider_error`, and the valuation agent one `invalid_reply`, before they worked on retry. All retries were on the same model.
- The saved runs are from before the rates were wired in from the ECB tool, so they show the models but not the rates.
