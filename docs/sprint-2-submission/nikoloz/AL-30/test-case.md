# Test case: AL-30

**Story:** As an underwriter, I read each agent's reasoning trail and the committee's consensus

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-156-deliberation-console` at commit `32029c4` (PR #195, open)

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as ciara@test.com (broker), whose client Ben Walsh owns the HELOC application `app-approved`, which has a seeded committee run `run-app-approved`.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for `app-approved` and open the Committee section. | Each voting agent shows its vote, rating, concerns, conditions and report, with the provider and model that produced it. | CommitteeConsole.test.tsx, committeeService.test.ts | ☐ Pass ☐ Fail |
| 2 | 2 | Look at the three votes and the Market & Macro report. | The three votes sit side by side with a disagreement marker when they differ. Market & Macro shows its outlook and source links, and no vote. | CommitteeConsole.test.tsx | ☐ Pass ☑ Fail |
| 3 | 3 | Read the strategist's credit memo. | The memo shows under its fixed headings, with the original and effective recommendation and any condition the policy gate added. | CommitteeConsole.test.tsx | ☐ Pass ☑ Fail |
| 4 | 4 | Open "View calls". Then open a failed run. | Every logged AI call for the run is listed (time, agent, model, outcome). A failed run shows the failed step and reason with a "Re-run" button. | CommitteeConsole.test.tsx, committeeService.test.ts | ☐ Pass ☐ Fail |
| 5 | 5 | As ciara@test.com, open the console on her own client's application, then try an application of another broker's client. | The console shows for her own client only. | committeeService.test.ts, loan-file.test.tsx | ☐ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-156-deliberation-console` at `32029c4`, 10 Nov 2026: **454 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- The run shown: `run-app-approved`, status Complete, started 26/9/2026 10:00, finished 10:06.
- Step 1: seen in the browser: Affordability voted Approve, rating strong, provider ollama, model qwen3.5:9b. Valuation voted Conditionally Approve, rating adequate, concern "There is no asking price, so the value rests on the model estimate alone.", provider mistral, model mistral-small-4. Strategist voted Approve, rating and concerns "Not applicable to the strategist", provider gemini. The seeded reports are placeholder text, and conditions were not checked. Not run yet: a run with real stored reports and conditions, once Nic's agent outputs (merged 12 Nov) are seeded.
- Step 2: "Votes disagree" showed, and Market & Macro showed "Context only. Market & Macro does not vote." Fail: the screen says "Macro sources are not stored." because the backend does not store the source links yet.
- Step 3: the original recommendation (Approve) and the effective one (Conditionally Approve) showed, and the credit memo showed. Fail: the memo's fixed headings are not stored by the backend, so the memo cannot show under them. The seeded memo is placeholder text.
- Step 4: "View calls" listed four calls with provider and model: affordability 1200 ms, valuation 1650 ms, market 2100 ms, strategist 2550 ms. Not run yet: a failed run in the browser (no failed run is seeded). The failed step, reason and Re-run button are unit tests only (CommitteeConsole.test.tsx). Re-run is shown disabled because the re-run endpoint is not built in al-ai.
- Step 5: the console showed for Ciara's own client. Not run yet: opening another broker's client's application with the console on this branch. Refusing a mismatched broker application is unit tested (committeeService.test.ts, loan-file.test.tsx).
- No console errors during the run.
