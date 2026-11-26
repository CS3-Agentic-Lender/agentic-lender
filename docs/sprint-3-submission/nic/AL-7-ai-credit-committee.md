# Use case: AL-7 AI Credit Committee (Sprint 3 update)

A committee of AI agents reviews every submitted application and the underwriter can read how they got to their answer. This is the Sprint 2 use case with the Sprint 3 changes added, so it matches the committee as it runs on `main` at the end of Sprint 3. Everything that changed is listed under "Changes since Sprint 2".

| Item | Detail |
|---|---|
| Epic | AL-7 AI Credit Committee |
| Feature (from the brief) | AI: Agentic AI Architecture (the four agents); Model Diversity & Local Inference. Web: AL-AI Audit & Deliberation Console. Mobile: AL-AI Interface (LTV, DTI, approval likelihood). |
| Owner | I own the agents, the committee run and the borrower's figures (al-ai). Nikoloz owns the reasoning screen (portal, AL-30). Ibrahima owns the borrower's figures screen (iOS, AL-31). Dumi built the AI call log (AL-140). |
| Sprints | Sprint 1 (8 to 25 Oct 2026) built the affordability agent (AL-25). Sprint 2 (27 Oct to 15 Nov 2026) built the other three agents, the providers, the policy gate, the full committee run and its auto-start. Sprint 3 (16 to 28 Nov 2026) put it on AWS with Bedrock (AL-129, AL-180), recovered interrupted runs (AL-327), added the re-run endpoint and live progress while a run goes (AL-344). |
| Wireframes | Week 3 prototypes in `docs/week 3 report/`: the portal's underwriter loan file review (pages 25 to 40) and the borrower app's application status (pages 42 to 47). The agent stories have no screen, so each story folder in `nic/` has a flow diagram instead. |

## Goal

As an underwriter, I want a committee of AI agents to review every application and show their reasoning, so that I start my decision from a full, explained assessment.

## Actors

The borrower submits the application on the iOS app and that starts the run. Later the borrower sees their indicative LTV, DTI and approval likelihood (AL-31). Every application has a broker through its `brokerId` and every run and AI call is recorded against it. An application with no broker isn't run. The underwriter reads the reasoning, the credit memo and the recommendation in the portal (AL-30) and makes the decision. Since 23 Nov the committee console is for underwriters only (read-only for admins). Brokers see the outcome and the conditions, not the agents' reasoning and only underwriters can read `ai_calls` (AL-334).

Inside al-ai a Firestore listener (switched on with `AUTO_START_COMMITTEE=true`) watches for Applied applications. It claims each one and runs the committee in the background, two at a time. Firestore holds the application, its status and the `ai_runs` and `ai_calls` documents. The two official rates come from the ECB data portal.

The agents and their models are pinned in `al-ai/app/llm/agents.json`:

| Agent | Provider | Model |
|---|---|---|
| Market and macro | Gemini (cloud), with Serper web search | `gemini-3.1-flash-lite` |
| Affordability | Ollama (local); on AWS, Amazon Bedrock (`agents.aws.json`) | `qwen3.5:9b`; on AWS `qwen.qwen3-32b-v1:0` (Qwen3 32B, eu-west-1) |
| Valuation | Groq (cloud) | `openai/gpt-oss-120b` (backup, switched by hand: Gemini `gemini-3.1-flash-lite`) |
| Strategist | Gemini (cloud) | `gemini-3.1-flash-lite` |

## Preconditions

- The application is Applied, has a broker, has never had an AI run (`aiRunStatus` is empty) and has a county, property type and BER the valuation model knows.
- al-ai is running with the listener on and the saved valuation model loaded. The Gemini, Groq and Serper keys are set and Ollama is reachable.
- The ECB rates can be fetched, either from the ECB or from a cache that isn't too old.

## Trigger

The borrower's submit moves the application to Applied. The listener sees this and claims the application in a Firestore transaction, so two listeners or two events only ever start one run. Applications that are already Applied when al-ai starts get picked up too.

## Main flow

1. Claim. In one transaction the listener sets `aiRunStatus = running` and `aiRunId` on the application and creates `ai_runs/{runId}`. It also writes the borrower's indicative figures: DTI at the benchmark rate, purchase LTV against the asking price and the approval likelihood. The submit has already returned by now, so the run carries on in the background.
2. Validate. A missing broker, or a county, property type or BER the model doesn't know, stops the run here before any model is called.
3. Valuation model. The saved model values the home. It gives back its estimate, the breakdown and any low-support warnings.
4. Market and macro. Code loads the two ECB rates. The market agent gets those rates and a few Serper search results (no borrower data). It replies with an outlook (rising, stable or falling), a short summary and its sources. The listener shares one report store across its runs, so the report gets reused for the rest of the day unless the rates change (AL-307).
5. Code calculations. Code works out every figure the agents will quote and every limit the gate will check: repayments, the stressed repayment at the benchmark rate plus 2 points, DTI, surplus, the price gap, the "price needs review" flag, both LTVs and the policy breaches.
6. Affordability and valuation agents, side by side. The first explains the affordability figures. The second explains whether the price is in line and how sure the estimate is. Each one gives a recommendation and each reply is checked against a schema and the figures it was given.
7. Strategist. It gets the two reports, the market view and a loan summary with no name or contact details. Code also adds a note on whether the two agents disagree. It replies with Approve, Conditionally Approve or Decline, its conditions and a credit memo under six fixed headings: Application summary, Affordability, Property assessment, Market context, Disagreements and Recommendation and conditions.
8. Policy gate. Code applies the limits to the strategist's recommendation (see Business rules). It keeps both the original and the effective recommendation.
9. Save. The run record holds every step's output, plus the provider, model, prompt version and attempts of each AI call. (The local runner saves this record as a JSON file instead.) While the run goes, each step's progress (queued, running, then ok or failed) and each agent's report are written to `ai_runs` as soon as they're ready, so the portal can show the committee working live (AL-344). At the end one transaction writes:
    - to `ai_runs`: status complete, each agent's report and vote, the credit memo, the recommendations, the consensus and the policy gate result (AL-62, AL-305);
    - to `review/underwriting`: the policy gate result, the risk tier and the LTV band (AL-305, AL-301);
    - to the application: `aiRunStatus = complete`, the move to AI Deliberated with a `statusHistory` entry (actor committee), the borrower's figures worked out again with the run's rate and valuation and for a mortgage its LTV percentage against the model's estimate (AL-63, AL-304);
    - to `ai_calls`: one document for every model attempt, every Serper search, the valuation model's call and any reused market report. The id is `{runId}-{step}-{attempt}` (AL-140).
10. The underwriter reads the reasoning and memo in the portal and decides. The borrower sees the indicative figures in the app.

## Alternative flows

A HELOC uses the HELOC rules (valuation prompt v2). The gate checks the combined LTV (what's owed plus the new line) against the model's estimate. Every HELOC gets the condition "Requires an independent surveyor's valuation (HELOC)". On submit the approval likelihood is Unknown because there's no valuation yet. When the run completes the borrower gets the combined LTV and a label.

A failed run can be run again as a new run linked to it (`rerunOf`). The failed record is left as it is and only the application's latest run can be re-run. An underwriter starts it with `POST /ai/committee/runs {"application_id": ...}` (underwriter only, PR #277) or from the local runner (`python -m app.committee <application> --rerun <run id>`). The listener never restarts a failed run by itself, so an outage can't cause a loop.

A run that's still `running` more than 10 minutes after it started (a deploy or crash stopped it) is stale. The listener checks for stale runs at start and every minute. In one transaction it marks the old run failed with `failureReason: "interrupted"` and starts a new run with `rerunOf` (AL-327, PR #254). A stale run can also be re-run by hand.

The same flow runs with no Firestore through `cd al-ai && uv run python -m app.committee <application.json>`. This saves the run record as a JSON file. The two real runs from 4 Nov are in `al-ai/docs/committee-evidence/`.

If Groq is down or rate-limited, a person changes the valuation agent's model in `agents.json` to the Gemini backup. The code never switches by itself, so the log always shows the model that really answered.

On AWS the affordability agent runs on Qwen3 32B on Amazon Bedrock instead of Ollama (AL-129, PR #219). Only the ECS task sets `AL_AGENTS_CONFIG=agents.aws.json`, so local runs keep Ollama. A live run from 23 Nov is in `evidence/al231-evidence-committee-log.txt`.

## Exceptions

- An invalid application or a missing broker fails the run at validate, with the reason.
- With no ECB rate, no borrower figures are written on claim. The run fails at the market step and names the missing rate. If the search fails, the market step fails and says why. Nothing gets made up.
- The step is retried once, with the reason shown, if a reply breaks the schema, quotes a figure it wasn't given, tries to clear a flag the code set or (market agent) links a page that wasn't in the search results. If the retry gets rejected too, the step fails.
- A provider timeout or outage is retried up to twice, after 2 s and then 8 s, or after the provider's Retry-After if that's longer. A 429 or 503 waits 10, 30 then 60 s between attempts (PR #276). A missing key fails straight away. No other provider is used in its place.
- When the committee loads the ECB rates in the background it waits up to 30 s and al-ai warms the rate cache when it starts (PR #269). The 6 s limit stays for `/ai/affordability`, because the iPhone gives up on that after 15 s.
- Each call gets 60 s and the whole run gets 5 minutes. When time runs out the step stops and the run fails with that reason.
- When a step fails, the steps after it are skipped and the run is saved as failed. The failed step and reason go on the `ai_runs` document, never on the application, because the borrower can read the application. The application gets `aiRunStatus = failed` and stays at Applied. The borrower's figures from submit stay and there's no recommendation. A crash outside the steps is recorded the same way (failed step `run`), so an application is never left stuck on running.
- If an application is claimed twice, the second claim loses the transaction and starts nothing. A late write from a run that's no longer the latest can't change the application's status and since PR #283 it can't overwrite the review either, because the check and the write happen in one transaction.

## Postconditions

On success there's one completed `ai_runs` document, the application is at AI Deliberated with a history entry, the borrower's figures are worked out again from the run and the risk tier and policy gate result are saved on `review/underwriting`. On failure the run is marked failed with its step and reason, the application stays at Applied and no agent has decided anything.

## Business rules

- Code owns the numbers: repayments, DTI, LTV, the bands, the price gap and the policy breaches. An agent explains and recommends. It can never change a figure or clear a flag.
- The policy gate is code and runs after the strategist. For a purchase the loan can be up to 4 times income for a first-time buyer and 3.5 times otherwise and up to 90% of the asking price. The LTV limit uses the asking price, never our estimate, because the estimate isn't a legal valuation. For a HELOC, what's owed plus the new line can be up to 3.5 times income and up to 80% of the home's estimated value. Exactly on a limit is fine.
- Each breach adds the condition "Requires lender exception review" with its rule ID. An Approve that has to carry any condition becomes Conditionally Approve. A Decline stays a Decline with no conditions. A breach never makes a recommendation better for the borrower.
- The borrower's LTV, DTI and approval likelihood are indicative and not verified. The approval likelihood is Unknown, Low, Medium or High, never a percentage. It's separate from the committee's recommendation.
- The steps run in a fixed order under LangGraph. No agent picks the route.
- The committee uses two cloud APIs (Gemini and Groq) and one local model (Ollama). Model IDs are pinned, never "latest" and there's no automatic fallback.
- No name, email address, phone number or full Eircode reaches a prompt. Gemini and Groq run on free keys, so only made-up data goes through them.
- The committee advises. The underwriter decides.

## Flow diagrams

The committee pipeline (`docs/diagrams/05-committee-pipeline.png`):

![Committee pipeline](../../diagrams/05-committee-pipeline.png)

The submit and the automatic start (`docs/diagrams/03-flow-submit-ai-review.png`):

![Submit and automatic start](../../diagrams/03-flow-submit-ai-review.png)

## Stories in this epic

| Story | What | Owner | Sprint | Status on 26 Nov |
|---|---|---|---|---|
| AL-25 | Affordability agent reports disposable surplus, stress-tested repayments and DTI | Nic | 1 | Done |
| AL-26 | Valuation agent flags overvalued collateral and computes LTV | Nic | 2 | Done |
| AL-27 | Market research agent pulls current central bank rates and mortgage trends | Nic | 2 | Done |
| AL-28 | Strategist decides Approve, Conditionally Approve or Decline and writes a credit memo | Nic | 2 | Done |
| AL-29 | The agents run on two cloud LLM APIs plus a local Ollama model | Nic | 2 | Done |
| AL-130 | The committee runs end to end on each application and saves one run record | Nic | 2 | Done |
| AL-30 | Underwriter reads each agent's reasoning trail and the committee's consensus | Nikoloz | 2 and 3 | In Progress |
| AL-31 | Borrower sees their estimated LTV, DTI and approval likelihood | Ibrahima | 2 | Done |

Sprint 2 subtasks: AL-122 to AL-128, AL-138, AL-139, AL-141, AL-201, AL-246, AL-290, AL-291, AL-63, AL-62, AL-140 (Dumi), AL-124 (Dumi), AL-301, AL-304, AL-305 and AL-307.

## Changes since Sprint 2

- On AWS the affordability agent runs on Bedrock Qwen3 32B (AL-129, PR #219). It's been live since 23 Nov.
- Interrupted runs don't stay `running` for ever any more: the listener replaces a stale run (AL-327, PR #254).
- Underwriters can re-run a failed or stale run with `POST /ai/committee/runs` (PR #277). This replaces the Sprint 2 line "nothing in the app calls it".
- The valuation step saves `valuationDetail` and the affordability step saves `dtiBreakdown` on `review/underwriting` as soon as each one finishes, so a later failure doesn't lose them (PR #278). Since PR #283 (merged 24 Nov) each of those saves checks the run still holds the application in the same transaction, so a re-run can't have its review overwritten by the old run.
- Each run writes one JSON line per step to stdout, so CloudWatch shows the run (PR #270).
- Gemini 429/503 back-off (PR #276) and the longer background ECB wait (PR #269), both found on the first live runs.
- Live progress: each step's status and each agent's report are written to `ai_runs` while the run goes and the console's agent tabs show queued, thinking, then done (AL-344, with AL-345 for al-ai and AL-346 for the portal, merged in PR #284 on 25 Nov). AL-344 has no parent epic set in Jira.
- The committee console is now for underwriters only, by team decision on 23 Nov (recorded on AL-333). Only underwriters can read `ai_calls` (AL-334, Dumi).
- Sprint 3 subtasks and tickets: AL-129, AL-327, AL-344, AL-62 (carried over, Done 12 Nov).

## Changes since Sprint 1

- The valuation agent runs on Groq `openai/gpt-oss-120b`, not Mistral. Mistral has no free API tier, so the team agreed to drop it on 28 Oct. The backup we switch to by hand is now Gemini, not Groq.
- The market step now runs before the code calculations, because they use the ECB rates it loads. The affordability and valuation agents then run side by side and the strategist waits for both.
- Rates come from the ECB: the Irish new mortgage rate (the benchmark) and the ECB main refinancing rate. They're cached in Firestore for a day and a rate older than 3 months is refused. No rate is ever guessed.
- Retries work as the Exceptions section says. Sprint 1 planned one schema retry and then a failure.
- A failed run is still saved, with its failed step and reason.
- Sprint 1 said an underwriter would start a re-run with `POST /ai/committee/runs`. In Sprint 2 that endpoint didn't exist yet. It does now (PR #277, see above).
- The committee also handles HELOC applications (AL-201) and each run now saves the reasoning, policy gate result, risk tier and AI calls that Sprint 1 only planned.

## Still to do

The reasoning screen (AL-30, Nikoloz) is still In Progress. On 26 Nov Nikoloz said the only thing left is the Re-run button on a failed run, which is still disabled. He's wiring it to `POST /ai/committee/runs` now and the story closes when that merges.

The model decisions and the smoke test that passed on 27 Oct are in `docs/infrastructure.md`. The test cases are in `test-case.pdf` in each story folder in `nic/`.
