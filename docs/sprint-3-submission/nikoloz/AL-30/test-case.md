# Test case: AL-30

## Sprint 3 update

Evidence cut-off: 26 Nov 2026. Code audit against main ebcfa88 records criteria 1-3 met in code: agent details, disagreement marker, Market & Macro sources and memo headings. This is not a new browser pass. For steps 2-4 below: **re-test needed on a real run**.

| # | Criterion | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | "For an application's latest committee run, the console shows each agent's vote (Approve / Conditionally Approve / Decline), rating, concerns, conditions and report, with the provider and model that produced it." | Open the latest run as an underwriter; inspect each voting agent. | All named stored fields appear for each agent. | Main ebcfa88 audit confirms the fields; historical seeded-field browser Pass is retained below. No new Sprint 3 browser run. | Not run |
| 2 | "The three votes sit side by side with an "agents disagree" marker when they differ; the Market & Macro report shows its outlook and source links but no vote." | Compare votes and open a real Market & Macro report. | Side-by-side votes, disagreement marker, outlook and source links; no Macro vote. | Code audit confirms implementation. Historical seed showed disagreement but lacked stored Macro sources (Fail). Real-run re-test not done. | Not run |
| 3 | "The strategist's memo shows under its fixed headings, with its original and effective recommendation and any condition the policy gate added." | Read a real strategist memo and policy gate. | Fixed headings, original/effective recommendation and added conditions. | Audit confirms implementation. Historical seed lacked headings (Fail); handwritten fixture checked the fix. Real-run re-test not done. | Not run |
| 4 | ""View calls" lists every logged AI call for the run (time, agent, model, outcome); a failed run shows the failed step and reason with a "Re-run" button." | Open View calls and a failed run; select Re-run. | Every logged call, failure step/reason and a working re-run. | Audit confirms calls/failure details. Historical disabled Re-run failed; enabled button is in open PR #290. Complete real browser re-run not done. | Not run |
| 5 | "A broker sees the console only for their own clients' applications." | Compare the original broker criterion with the agreed access rule. | Apply the 23 Nov team decision: underwriter committee; broker outcome and conditions. | Changed on 23 Nov, recorded on AL-333 and comment 10955. Main enforces the revised rule; new browser check remains Not run. Historical own-client broker Pass tested the previous rule. | Changed by team decision |

The old broker-access step 5 below describes the previous rule. The current criterion is recorded as Changed by team decision, rather than a test pass. Current main also permits read-only admins.

PR #290: 74 tests pass in the two touched files. Full suite 1127/1133 in both runs; five failing files pass alone after load timeouts. The sign-out alert test on /broker also fails on untouched main. Hosted preflight returns 200 with POST allowed; this is not a completed committee run. tsc -b, build and betterleaks clean. The suite is not entirely passing.

## Sprint 2 record

The historical steps and outcomes below are retained. The Actual result column summarises the original notes.

**Story:** As an underwriter, I read each agent's reasoning trail and the committee's consensus

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-156-deliberation-console` at commit `32029c4` (PR #195, open)  
**Re-run:** 15 Nov 2026 on `main` at `f41a283` (after #195 merged on 12 Nov), emulators started from main's seed.

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as ciara@test.com (broker), whose client Ben Walsh owns the HELOC application `app-approved`, which has a seeded committee run `run-app-approved`.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Actual result | Result |
|---|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for `app-approved` and open the Committee section. | Each voting agent shows its vote, rating, concerns, conditions and report, with the provider and model that produced it. | CommitteeConsole.test.tsx, committeeService.test.ts | Stored fields matched seeded run. | Pass |
| 2 | 2 | Look at the three votes and the Market & Macro report. | The three votes sit side by side with a disagreement marker when they differ. Market & Macro shows its outlook and source links, and no vote. | CommitteeConsole.test.tsx | Disagreement shown; sources not stored. | Fail |
| 3 | 3 | Read the strategist's credit memo. | The memo shows under its fixed headings, with the original and effective recommendation and any condition the policy gate added. | CommitteeConsole.test.tsx | Seeded memo lacked headings. | Fail |
| 4 | 4 | Open "View calls". Then open a failed run. | Every logged AI call for the run is listed (time, agent, model, outcome). A failed run shows the failed step and reason with a "Re-run" button. | CommitteeConsole.test.tsx, committeeService.test.ts | Calls/failure shown; Re-run disabled. | Fail |
| 5 | 5 | As ciara@test.com, open the console on her own client's application, then try an application of another broker's client. | The console shows for her own client only. | committeeService.test.ts, loan-file.test.tsx | Own client allowed; other broker refused. | Pass |

## Automated test run

al-web Vitest on `feature/AL-156-deliberation-console` at `32029c4`, 10 Nov 2026: **454 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- The run shown: `run-app-approved`, status Complete, started 26/9/2026 10:00, finished 10:06.
- Step 1: seen in the browser: Affordability voted Approve, rating strong, provider ollama, model qwen3.5:9b. Valuation voted Conditionally Approve, rating adequate, concern "There is no asking price, so the value rests on the model estimate alone.", provider mistral, model mistral-small-4. Strategist voted Approve, rating and concerns "Not applicable to the strategist", provider gemini. Re-run on 15 Nov on `main`: for each of the three voting agents the screen showed the vote, rating, concerns, conditions ("None recorded" where the stored list is empty), report, provider, model and prompt version, and every value matched the stored run document `ai_runs/run-app-approved` read from the emulator. The seeded reports are still placeholder text ("Seeded affordability report for app-approved."), so this checks that the stored fields are shown, not what a real report reads like.
- Step 2: "Votes disagree" showed, and Market & Macro showed "Context only. Market & Macro does not vote." Fail: the screen says "Macro sources are not stored." because the backend does not store the source links yet.
- Step 3: the original recommendation (Approve) and the effective one (Conditionally Approve) showed, and the credit memo showed. Fail: the memo does not show under its fixed headings. The seeded memo is placeholder text. Correction on 15 Nov to what I wrote here on 10 Nov (that the backend does not store the headings): a real run does store them. al-ai writes the memo as one text with six `## heading` lines, and the portal on `main` prints that text as it is, so the headings would show as plain lines; the seeded memo has no headings at all. The portal part is fixed on the branch `feature/AL-156-credit-memo-headings` (commit `a1db6e7`, not merged yet), checked in the browser against a memo in that format added to the emulator by hand: the six headings showed in order with their text. Still a fail on `main`.
- Step 4: "View calls" listed four calls with provider and model: affordability 1200 ms, valuation 1650 ms, market 2100 ms, strategist 2550 ms. Re-run on 15 Nov on `main`: on `app-deliberated` the list showed the four calls with agent, call id, provider, model, latency, time and the call output. No failed run is seeded (all five seeded runs are complete), so I added one by hand to the emulator for `app-applied` (status failed, step `valuation_agent`, a made-up reason) and removed it afterwards. The Committee section showed "Run status: Failed", "Failed step: valuation_agent" and the reason. Fail: the "Re-run" button is there but disabled, with "Re-running is not available yet.", because the re-run endpoint is not built in al-ai.
- Step 5: the console showed for Ciara's own client. Run on 15 Nov on `main`. In the portal, Ciara opened `app-approved` (her client Ben) and the Committee section and "View calls" showed. Opening `app-funded` and `app-deliberated` (Bob's client Alice) by URL gave "Application not available", with no Committee section, and the underwriter URL sent her to "Not allowed". The check does not rest on the screen: reading through Firestore with Ciara's token, `ai_runs/run-app-approved` and its four `ai_calls` came back, while `ai_runs/run-app-funded`, `ai_runs/run-app-deliberated`, their calls and the applications themselves were refused by the rules (403, also when the query asked for `brokerId` broker1). The same held the other way round: Bob was refused `ai_runs/run-app-approved`. With no token the read was refused too.
- No console errors during the run.
