# Use case: AL-7 AI Credit Committee (Sprint 2 update)

**Epic.** Every submitted application is reviewed by a committee of AI agents, and the underwriter can read their reasoning. So the underwriter starts from a full, explained assessment. This update shows the committee as it runs on `main` at the end of Sprint 2.

| Item | Detail |
|---|---|
| Epic | [AL-7](https://alprojectcs3.atlassian.net/browse/AL-7) AI Credit Committee |
| Feature (from the brief) | AI: Agentic AI Architecture (the four agents); Model Diversity & Local Inference. Web: AL-AI Audit & Deliberation Console. Mobile: AL-AI Interface (LTV, DTI, approval likelihood). |
| Owner | Nic (al-ai: the agents, the committee run and the borrower's figures). The reasoning screen is Nikoloz's (portal, AL-30). The borrower's LTV, DTI and approval likelihood screen is Ibrahima's (iOS, AL-31). The AI call log is Dumi's (AL-140). |
| Sprint | Sprint 1 (8 to 25 Oct 2026) built the affordability agent (AL-25). Sprint 2 (27 Oct to 15 Nov 2026) built the other three agents, the providers, the policy gate, the full committee run and its auto-start. |
| Built in Sprint 2 | The valuation agent (AL-26), the market and macro agent (AL-27), the strategist and policy gate (AL-28) and the provider setup (AL-29) are on `main`. The committee runs end to end in a fixed order, starts by itself when an application becomes Applied, saves one run record and moves the application to AI Deliberated (AL-130). The borrower's indicative LTV, DTI and approval likelihood are written on submit and worked out again when a run completes (AL-63). |
| Still open | Logging every AI call in Firestore (AL-140, Dumi's PR #177), saving each agent's reasoning for the portal (AL-62), the risk tier write after a run (AL-301), the Bedrock version (AL-129), a way to start a re-run from the app and both screens (AL-30, AL-31). |
| Wireframes | Week 3 prototypes: the portal's underwriter loan file review (pages 25 to 40 of the portal prototype) and the borrower app's application status (pages 42 to 47 of the borrower prototype), in `docs/week 3 report/`. The agent stories have no screen, so each story folder in `nic/` has a flow diagram as its wireframe. |

## Goal

As an underwriter, I want every application reviewed by a committee of AI agents with their reasoning visible, so that I start my decision from a full, explained assessment.

## Actors

- **Borrower:** signed in to the iOS app. Submitting the application starts the run. Sees their indicative LTV, DTI and approval likelihood (AL-31, In Progress).
- **Broker:** every application has the broker's ID (`brokerId`), and every run and AI call is recorded against it. An application with no broker isn't run.
- **Underwriter:** signed in to the portal. Reads the reasoning, the credit memo and the recommendation (AL-30, To Do) and makes the decision.
- **al-ai listener:** a Firestore listener inside al-ai, turned on with `AUTO_START_COMMITTEE=true`. It watches for Applied applications, claims each one and runs the committee in the background, two at a time.
- **al-core and Firestore:** hold the application, its status and the `ai_runs` documents.
- **The agents and their models** (pinned in `al-ai/app/llm/agents.json`):

| Agent | Provider | Model |
|---|---|---|
| Market and macro | Gemini (cloud), with Serper web search | `gemini-3.1-flash-lite` |
| Affordability | Ollama (local) | `qwen3.5:9b` |
| Valuation | Groq (cloud) | `openai/gpt-oss-120b` (backup, switched by hand: Gemini `gemini-3.1-flash-lite`) |
| Strategist | Gemini (cloud) | `gemini-3.1-flash-lite` |

- **ECB data portal:** where the two official rates come from.

## Preconditions

- The borrower has submitted the application. Its status is Applied and it has never had an AI run (`aiRunStatus` is empty).
- The application has a broker and valid details (a county, property type and BER the valuation model knows).
- al-ai is running with the listener on, the saved valuation model loaded, the Gemini, Groq and Serper keys set and Ollama reachable.
- The ECB rates can be got, either from the ECB or from a cache that isn't too old.

## Trigger

The borrower's submit moves the application to Applied. The listener sees it and claims it in a Firestore transaction, so two listeners or two events only start one run. Applications that were already Applied when al-ai starts get picked up too.

## Main flow

1. **Claim.** In one transaction the listener sets `aiRunStatus = running` and `aiRunId` on the application and creates `ai_runs/{runId}` (status running, trigger submit). It also writes the borrower's indicative figures: DTI at the benchmark rate, purchase LTV against the asking price and the approval likelihood. The borrower's submit has already returned, so the run happens in the background.
2. **Validate.** The application is checked against the committee's input model. A missing broker or an unknown county, property type or BER stops the run here, before any model call.
3. **Valuation model.** The saved valuation model values the home and returns its estimate, breakdown and any low-support warnings.
4. **Market and macro.** Code loads the two ECB rates. The market agent gets those rates and a few Serper search results (no borrower data). It replies with an outlook (rising, stable or falling), a short summary and its sources. The report is reused for the rest of the day unless the rates change.
5. **Code calculations.** Code works out every figure the agents will quote and every limit the gate will check: repayments, the stressed repayment at the benchmark rate plus 2 points, DTI, surplus and their bands, the price gap, the "price needs review" flag, both LTVs and the list of policy breaches.
6. **Affordability and valuation agents (side by side).** The affordability agent explains the affordability figures. The valuation agent explains whether the price is in line and how sure the estimate is. Each gives a recommendation, and each reply is checked against a schema and the figures it was given.
7. **Strategist.** It gets the two reports, the market view and a loan summary (no name or contact details). Code tells it whether the two voting agents disagree. It replies with Approve, Conditionally Approve or Decline, its conditions and a credit memo under six fixed headings: Application summary; Affordability; Property assessment; Market context; Disagreements; Recommendation and conditions.
8. **Policy gate.** Code applies the limits to the strategist's recommendation (see Business rules). Both the original and the effective recommendation are kept.
9. **Save.** The run record is built with every step's output, the provider, model, prompt version and attempts of each AI call and the order the steps ran in. The `ai_runs` document is marked complete.
   - In Firestore only the run's base fields are saved so far: status, times, trigger, failed step and reason. AL-62 adds the agents' output and the memo. The local runner saves the whole record as a JSON file.
   - In the same write the application gets `aiRunStatus = complete` and moves to **AI Deliberated** with a `statusHistory` entry (actor committee). The borrower's figures are worked out again with the run's rate and valuation.
10. **Read the result.** The underwriter reads the reasoning and memo in the portal (AL-30, To Do) and decides. The borrower sees the indicative figures in the app (AL-31, In Progress).

## Alternative flows

- **A. HELOC.** The valuation agent uses the HELOC rules (prompt v2). The gate checks the combined LTV (what is owed plus the line) against the model's estimate. Every HELOC gets the condition "Requires an independent surveyor's valuation (HELOC)". On submit the approval likelihood is Unknown, because there's no valuation yet. When the run completes the borrower gets the combined LTV and a label.
- **B. Re-run a failed run.** A failed run can be run again as a new run linked to the failed one (`rerunOf`), and the failed record is left as it is. Only a failed run that is still the application's latest run can be re-run. Today this works from the local runner (`python -m app.committee <application> --rerun <run id>`). The listener never restarts a failed run by itself, so an outage can't loop. Nothing in the portal starts a re-run yet.
- **C. Local runner.** `cd al-ai && uv run python -m app.committee <application.json>` runs the same flow with no Firestore and saves the run record as a JSON file. The evidence runs from 4 Nov are in `al-ai/docs/committee-evidence/`.
- **D. Valuation backup.** If Groq is down or rate-limited, a person changes the valuation agent's model in `agents.json` to the Gemini backup. The code never switches by itself, so the log always shows the model that really answered.
- **E. Deployed on AWS (planned, AL-129).** The affordability agent will run on Qwen3 32B on Amazon Bedrock instead of Ollama. Not built yet.

## Exceptions

- **Invalid application or no broker:** the run fails at validate with the reason.
- **No ECB rate:** no borrower figures are written on claim and the run fails at the market step, naming the rate.
- **Search fails:** the market step fails with the reason. Nothing is made up.
- **Rejected reply:** a reply is retried once, with the reason shown, if it breaks the schema, quotes a figure it wasn't given, tries to clear a flag the code set or (market agent) links a page that wasn't in the search results. If the retry is rejected too, the step fails.
- **Provider error:** a timeout, outage or rate limit is retried up to twice, after 2 s and then 8 s, or the provider's Retry-After if that's longer. A missing key fails straight away. No other provider is used instead.
- **Out of time:** each call gets 60 s and the whole run gets 5 minutes. When time runs out the step stops and the run fails with that reason.
- **A step fails:** the steps after it skip and the run is saved as failed. The failed step and reason go on the `ai_runs` document, never on the application, because the borrower can read that. The application gets `aiRunStatus = failed` and stays at Applied, the borrower's figures from submit stay and there's no recommendation.
- **Crash outside the steps:** the run is still recorded as failed (failed step `run`), so an application is never left running.
- **Claimed twice:** a second listener or event loses the transaction and starts nothing. A late write from a run that's no longer the application's latest can't move its status.

## Postconditions

- **Success:** one `ai_runs` document marked complete, the application at AI Deliberated with a history entry and the borrower's figures worked out again from the run.
- **Failure:** the run is marked failed with its step and reason, the application stays at Applied and no agent has decided anything.

## Business rules

- Code owns the numbers: repayments, DTI, LTV, the bands, the price gap and the policy breaches. An agent explains and recommends. Its reply is checked against a schema and the figures it was given, and it can never change a figure or clear a flag.
- The policy gate is code and runs after the strategist.
  - Purchase limits: loan up to 4 times income for a first-time buyer and 3.5 times otherwise, and loan up to 90% of the asking price.
  - The LTV limit is checked on the asking price, never on our model's estimate, because the estimate isn't a legal valuation.
  - HELOC limits: what is owed plus the line up to 3.5 times income and up to 80% of the home's estimated value.
  - Exactly on a limit is fine.
- Each breach adds the condition "Requires lender exception review" with its rule ID. An Approve that has to carry any condition becomes Conditionally Approve. A Decline stays a Decline with no conditions. A breach never makes a recommendation more favourable.
- The borrower's LTV, DTI and approval likelihood are **indicative, not verified**. Code works them out from the borrower's own numbers. The approval likelihood is Unknown, Low, Medium or High, never a percentage, and it's separate from the committee's recommendation.
- The steps run in a fixed order under LangGraph. Nobody, and no agent, picks the route.
- Agents run on two cloud APIs (Gemini and Groq) and one local model (Ollama). Model IDs are pinned, never "latest", and there's no automatic fallback.
- No name, email address, phone number or full Eircode reaches a prompt. Gemini and Groq run on free keys, so only made-up data goes through them.
- The committee advises. The underwriter decides.

## Flow diagram

The committee pipeline, from `docs/diagrams/05-committee-pipeline.png`. The submit and the run starting by itself are in `docs/diagrams/03-flow-submit-ai-review.png`.

## Stories in this epic

| Story | What | Owner | Sprint | Status on 9 Nov |
|---|---|---|---|---|
| [AL-25](https://alprojectcs3.atlassian.net/browse/AL-25) | Affordability agent reports disposable surplus, stress-tested repayments and DTI | Nic | Sprint 1 | Done |
| [AL-26](https://alprojectcs3.atlassian.net/browse/AL-26) | Valuation agent flags overvalued collateral and computes LTV | Nic | Sprint 2 | Done |
| [AL-27](https://alprojectcs3.atlassian.net/browse/AL-27) | Market research agent pulls current central bank rates and mortgage trends | Nic | Sprint 2 | Criteria 1 to 4 on `main`. Criterion 5 (every AI call logged) waits on AL-140 |
| [AL-28](https://alprojectcs3.atlassian.net/browse/AL-28) | Strategist decides Approve, Conditionally Approve or Decline and writes a credit memo | Nic | Sprint 2 | Done |
| [AL-29](https://alprojectcs3.atlassian.net/browse/AL-29) | The agents run on two cloud LLM APIs plus a local Ollama model | Nic | Sprint 2 | Done |
| [AL-130](https://alprojectcs3.atlassian.net/browse/AL-130) | The committee runs end to end on each application and saves one run record | Nic | Sprint 2 | All on `main` except logging every AI call, which waits on AL-140 |
| [AL-30](https://alprojectcs3.atlassian.net/browse/AL-30) | Underwriter reads each agent's reasoning trail and the committee's consensus | Nikoloz | Sprint 2 | To Do |
| [AL-31](https://alprojectcs3.atlassian.net/browse/AL-31) | Borrower sees their estimated LTV, DTI and approval likelihood | Ibrahima | Sprint 2 | In Progress (its backend, AL-63, is Done) |

## Changes since Sprint 1

- **Valuation agent model.** It runs on Groq `openai/gpt-oss-120b`, not Mistral. Mistral has no free API tier, so the team agreed to drop it on 28 Oct. The hand-switched backup is now Gemini `gemini-3.1-flash-lite`, not Groq.
- **Step order.** The market step now runs before the code calculations, because it gets the ECB rates they use. Then the affordability and valuation agents run side by side and the strategist waits for both.
- **Rates come from the ECB.** Code gets two ECB series (the Irish new mortgage rate as the benchmark and the ECB main refinancing rate). It caches them in Firestore for a day and refuses a rate older than 3 months. No rate is ever guessed.
- **Retries.** Sprint 1 said one schema retry, then fail. What we built: a rejected reply gets one retry with the reason shown, and a provider error that might clear gets up to two retries (after 2 s and 8 s). Each call has 60 s and the whole run has 5 minutes.
- **A failed run is still saved.** The steps after the failed one skip themselves and the run is saved as failed, with the failed step and the reason. The application stays at Applied.
- **Re-run.** Sprint 1 said an underwriter starts another review with `POST /ai/committee/runs`. That endpoint doesn't exist. A re-run is built in code for a failed run only (a new run linked to the failed one), but nothing in the app calls it yet, because we haven't decided what triggers a re-run.
- **HELOCs.** The committee now handles HELOC applications as well as mortgages (AL-201), with their own policy gate rules.
- **Borrower figures.** Code writes these on submit and again when a run completes (AL-63). They're labelled indicative, not verified.
- **Bedrock** is still planned (AL-129, To Do). Today every run uses Ollama for the affordability agent.

## Not built yet

| What | Ticket | Owner | Why it matters |
|---|---|---|---|
| Every AI call saved in a Firestore `ai_calls` collection | AL-140 (PR #177, In Review) | Dumi | Today each attempt is logged by the service and kept in the run record. The Firestore log closes AL-27 and AL-130 |
| Each agent's output, the memo and the consensus saved on `ai_runs` | AL-62 (To Do) | Nic | The listener only writes the run's base fields, so the portal has nothing to show until this lands |
| Risk tier and LTV band written after each run | AL-301 (To Do) | Nic | `write_risk` exists and is tested, but the run doesn't call it yet |
| A way to start a re-run from the app | not ticketed: trigger not decided | Team | The re-run works in code and from the local runner only |
| Affordability agent on Bedrock for the AWS deployment | AL-129 (To Do) | Nic | Only needed once the app is deployed |
| Reasoning screen and borrower figures screen | AL-30, AL-31 | Nikoloz, Ibrahima | The underwriter and borrower see the run's results |

## Notes

- Sprint 2 subtasks: AL-122 and AL-123 (valuation checks and agent), AL-124 (ECB rate tool, Dumi) and AL-125 (market agent), AL-126 and AL-127 (strategist and policy gate), AL-128 (providers and model config), AL-138 (LangGraph flow and local runner), AL-139 (retries, failed runs and re-run), AL-141 (auto-start), AL-201 (HELOC), AL-246 (risk tier rule), AL-290 (IDs on every call), AL-291 (ECB rates instead of the stand-in rate) and AL-63 (borrower figures).
- Model decisions and the smoke test that passed on 27 Oct are in `docs/infrastructure.md`. The model IDs are in `al-ai/app/llm/agents.json`.
- Evidence: two real runs on 4 Nov in `al-ai/docs/committee-evidence/`. One is a mortgage (Approve, kept as Approve) and one is a HELOC (Approve, changed by the gate to Conditionally Approve).
- Test cases: `test-case.pdf` in each story folder in `nic/`.
