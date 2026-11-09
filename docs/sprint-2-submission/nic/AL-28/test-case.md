# Test case: AL-28

As an underwriter, a strategist agent decides Approve / Conditionally Approve / Decline and writes a credit memo

| Item | Detail |
|---|---|
| Story | AL-28: As an underwriter, a strategist agent decides Approve / Conditionally Approve / Decline and writes a credit memo |
| Epic | AL-7 AI Credit Committee |
| Owner | Nic (al-ai: the strategist agent and the policy gate) |
| Sprint | Sprint 2 (27 Oct to 15 Nov 2026) |
| Wireframe | wireframe.png in this folder. AL-28 has no screen, so it is a flow diagram. |
| Code | `al-ai/app/strategist_agent.py`, `al-ai/app/policy_gate.py`, `al-ai/app/committee.py` and `al-ai/app/prompts/strategist_agent_v1.md`, on `main` at commit `86cd8d4` |
| Tested by | Nicholas Groenewald, 9 Nov 2026 |

## What this tests

The strategist reads the other agents' reports and a loan summary and writes a recommendation and a credit memo on Gemini. After it, a policy gate in code adds conditions for any Central Bank limit breach and can turn an Approve into Conditionally Approve. These tests check the reply, the disagreement rule, the gate and what gets saved.

## Wireframe

![Flow diagram](wireframe.png)

## Preconditions and test data

- I installed the `al-ai` dependencies with `uv` (`cd al-ai && uv sync`).
- The automated tests need no API keys and no network, because the strategist and the committee use a fake network.
- `AL_LIVE_LLM` isn't set, so the live test skips.
- The manual live run needs a Gemini key in `al-ai/.env` as `GEMINI_API_KEY`.

## Test cases

| ID | Acceptance criterion | Steps | Expected result | How it was checked, and the result |
|---|---|---|---|---|
| TC-28-01 | Given the three reports and a loan summary with no name or contact details, the agent on Gemini returns JSON that passes the schema check: recommendation, conditions and a memo under the fixed headings. | 1. Build the facts from three reports and a loan summary. 2. Try a loan summary with an extra field and a report holding an email or phone number. 3. Feed fake good and bad replies. 4. Live (manual, not run in this test): `cd al-ai && uv run python -m app.strategist_agent`. | Only the chosen loan fields are allowed and an identifier stops the step before the prompt is built. A reply passes only with `recommendation` (Approve / Conditionally Approve / Decline), `conditions` and a `memo` with exactly the six sections, written out under the fixed headings in order. The model is Gemini from `agents.json`. | Automated: `test_strategist_agent.py`: `test_the_facts_hold_the_three_reports_and_the_loan_summary`, `test_a_loan_summary_with_any_field_we_did_not_choose_is_refused`, `test_a_personal_identifier_inside_a_report_is_refused_before_it_reaches_the_prompt`, `test_no_personal_identifier_reaches_the_prompt`, `test_a_good_reply_passes`, `test_a_reply_with_a_bad_field_is_rejected`, `test_every_memo_section_is_needed_and_must_be_text`, `test_an_extra_memo_section_is_rejected`, `test_the_memo_is_written_out_with_the_headings_from_the_ticket_in_order`, `test_the_agent_is_the_one_agents_json_names_for_the_strategist`. Live run not done in this test. **Pass.** |
| TC-28-02 | When the voting agents disagree, the Disagreements section names who disagreed and why the strategist sided as it did. | 1. Give facts where the affordability and valuation votes differ. 2. Feed a fake reply whose Disagreements section doesn't name both agents. | Code sets `voting_agents_disagree`. A Disagreements section that doesn't name the Affordability agent and the Valuation agent is rejected, retried once, then the step fails. | Automated: `test_strategist_agent.py`: `test_the_agents_that_disagree_are_worked_out_by_code`, `test_when_the_voting_agents_disagree_the_disagreements_section_names_both`, `test_when_they_agree_the_disagreements_section_may_say_so`, `test_a_reply_that_hides_a_disagreement_is_retried_then_fails`. **Pass** for naming who disagreed. "Why it sided" is a prompt rule only, not checked in code (Note 1). |
| TC-28-03 | A code gate runs after the agent. Every breach adds a "requires lender exception review" condition, Approve becomes Conditionally Approve and Decline stays Decline. | 1. Call `apply_policy_gate` with Approve and a breach, Conditionally Approve and a breach, and no breach. 2. Run a committee with a mortgage over the 90% LTV limit. | Each breach adds "Requires lender exception review (RULE)". Approve becomes Conditionally Approve, Conditionally Approve keeps its conditions plus the new one, Decline stays Decline and no breach changes nothing. | Automated: `test_policy_gate.py`: `test_approve_with_a_breach_becomes_conditionally_approve_with_the_exception_condition`, `test_conditionally_approve_with_a_breach_keeps_its_conditions_and_adds_the_new_one`, `test_approve_with_no_breach_is_left_alone`, `test_conditionally_approve_with_no_breach_keeps_its_conditions_exactly`, `test_every_breach_adds_its_own_condition`, `test_decline_with_a_breach_stays_decline_and_the_breach_is_recorded`, `test_the_gate_never_makes_a_recommendation_more_favourable`. `test_committee.py`: `test_a_mortgage_over_the_ltv_limit_gets_an_exception_condition_and_the_approve_becomes_conditional`. **Pass.** |
| TC-28-04 | The original and the effective recommendation are both saved, with the rule that changed it. | 1. Run the committee. 2. Read the saved run record. | The record has `original_recommendation`, `effective_recommendation` and `steps.policy_gate` with the `breaches` (rule IDs) and `changed`. | Automated: `test_committee.py`: `test_a_run_saves_one_record_with_a_unique_run_id_and_the_fields_from_the_ticket`, `test_a_mortgage_over_the_ltv_limit_gets_an_exception_condition_and_the_approve_becomes_conditional`, `test_the_record_can_be_written_as_json_and_kept_in_a_file`. **Pass** in the run record. Not in Firestore yet (Note 2). |
| TC-28-05 | The result is labelled a recommendation, and the underwriter's sign-off in the portal is the lending decision. | 1. Read the record fields and the prompt. 2. Open the loan file in the portal as an underwriter. | The result is called a recommendation and the underwriter's sign-off is the decision. | No automated test for the portal. The record fields are named `original_recommendation` / `effective_recommendation`, and the prompt says "You recommend and the human underwriter decides". **Not met yet:** the portal doesn't show the recommendation, because the agent output isn't written to Firestore yet (Note 2). |

## Test run

From `al-ai` on `main` at `86cd8d4`, 9 Nov 2026: `uv run pytest -q -p no:cacheprovider tests/test_strategist_agent.py tests/test_policy_gate.py tests/test_committee.py`

**110 passed, 1 skipped.** The skipped one is `test_live_the_configured_strategist_writes_a_checked_memo`, which only runs with `AL_LIVE_LLM=1` because it makes a real Gemini call. I made no live model call for this test case.

## Notes

1. **Why the strategist sided.** `check_reply` only checks that the Disagreements section names both agents when they disagree. The "say which one you side with and why" part is in the prompt (`al-ai/app/prompts/strategist_agent_v1.md`).
   - The saved real run in `al-ai/docs/strategist-agent-runs.json` (Gemini `gemini-3.1-flash-lite`) does it: "I side with the Valuation agent because the model LTV of 95.0% exceeds the 90% limit".
   - I didn't repeat that run today.
2. **Where it's saved.** The committee keeps the original and effective recommendation and the gate's output in its run record. The local runner writes that as a JSON file (`JsonFileRunStore`), and two saved runs are in `al-ai/docs/committee-evidence/`.
   - On the deployed path, `auto_start.finish` only writes the run status, finish time and failure fields to `ai_runs`.
   - The `originalRecommendation`, `effectiveRecommendation`, `policyGate` and `creditMemo` fields are in `al-core/SCHEMA.md`, but al-ai doesn't write them yet. The code comment says a later ticket adds the agent output.
   - Until then the portal has nothing to show for criterion 5.
3. The rule IDs are `LTI_CAP`, `LTV_CAP` and `CLTV_CAP`, so the added condition reads, for example, "Requires lender exception review (LTV_CAP)".
   - A HELOC also always gets "Requires an independent surveyor's valuation (HELOC)". That alone turns an Approve into Conditionally Approve. It's policy, not a breach.
