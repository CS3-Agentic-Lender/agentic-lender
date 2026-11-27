# Test case: AL-40

**Story:** As an underwriter, I apply a +100 to +300 bps rate shock and see how the portfolio holds up

**Tested by:** Nikoloz Chilachava (recorded evidence)  
**Evidence cut-off:** 27 Nov 2026  
**Build:** recorded evidence on origin/main at ebcfa88; PR #292 branch afe9585 verified separately on 27 Nov, not merged.

## Preconditions

- Sign in as an underwriter. For the recorded local run, use seeded Firebase emulators and reachable al-ai.
- Backend: POST /ai/portfolio/rate-shock. The live URL correction is not merged.

## Steps

| # | Criterion | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | "A slider sets the shock from +100 to +300 bps in steps of 25; moving it updates the chart within 1 second of receiving a successful backend result." | Move the slider across +100 to +300 bps in 25-bps increments; time the redraw after a successful response. | Valid range/step and chart update within 1 second of receiving success. | PR #266 tests limits, debounce, reset and stale replies. Local API run measured 4 applications; +200 gave 41.4% DTI and +300 redrew to 44.2%. Backend answered in 78 ms; response-to-chart timing was not measured separately. Every-control browser run remains Not run. | Partly |
| 2 | "The chart shows how many applications are in each affordability band (comfortable / caution / adverse) before and after the shock." | Compare band totals before and after the rise in the stage, tiles and table. | Counts for comfortable, caution and adverse before and after. | Before/after affordability-band chart added in PR #292 (in review), reading backend totals.before / totals.after, with a screen-reader table. Two new automated tests verify backend counts and visibility. | Pass once #292 merges |
| 3 | "A table lists the applications that move into a worse band, with their new repayment and DTI; clicking one opens its loan file." | Read worse-band rows in Every application and follow a loan-file link. | New repayments and DTI; correct loan-file destination. | PR #266 tests worse-band ordering and links. Current main retains all applications worst-band first, before/after repayment, DTI and bands, with loan-file links. PR #286 tests tower selection and table marking; separate current-design link browser run not recorded. | Pass |
| 4 | "The figures come from the backend rate-shock calculation, and one application's numbers match a hand-checked example." | Compare the backend response with one hand-calculated application. | Displayed values agree with the backend and hand calculation. | PR #266 records app-deliberated at +200 bps: 4.00% -> 6.00%, EUR 1,265 -> 1,589 monthly and DTI 36.2% -> 41.4%. Hand calculation: EUR 1,265.15 -> 1,588.81 and 36.24% -> 41.42%. Local run used a manually cached 3.9% ECB rate for the application lacking a stored rate. Full worked example: worked-example.md. | Pass |
| 5 | "Only underwriters (bank staff) can open the simulator." | Open the simulator as an underwriter and attempt access as a broker. | Only underwriters can open it. | PR #266 automated checks cover broker refusal and 403. Local underwriter API browser run succeeded. No new full role browser run recorded. | Pass |

## Automated test run

PR #266: 33 new tests; npm test recorded 756/756, then 769/769 after merging main; npm run build passed. PR #286: 1048 passed, then 1054 after review commit 712a559 (facts). tsc -b, npm run build and betterleaks clean in PR evidence.

### PR #292 verification - 27 Nov 2026

On branch afe9585: npm test passed 58 files / 1,103 tests, including the two new chart tests. npm run build (including TypeScript) passed. betterleaks found no leaks. The earlier auth-routing failure did not reproduce in this run. No new live browser check was performed for the chart.

## Notes

The original local run needed a manually cached ECB mortgage rate of 3.9% after a timeout. The earlier redesign removed the band chart; PR #292 restores before/after affordability bands and is in review. Separate DTI and surplus charts remain removed. Re-test the hosted service after PR #288 lands.

Earlier checks are historical evidence; the PR #292 automated verification above was run again on 27 Nov. Criterion wording is quoted from the supplied verbatim Jira acceptance-criteria file; results distinguish browser, preview, automated and code-audit evidence.

## Earlier grouped checks retained as evidence

These preserve the previously recorded results and unrun checks; their former row numbers were not Jira criterion numbers. They do not replace the criterion table above.

- **Rate rise** ? Steps: Open Stress test; select +200, then +300 bps. Expected: Show returned affordability figures for the selected rise. Actual: PR #266 local API browser run: 4 measured. One loan DTI 36.2% to 41.4% at +200, then 44.2% at +300. Recorded result: Pass (local API run).

- **Controls** ? Steps: Use slider, presets, Recalculate and Reset. Expected: Allow +100 to +300 bps; reset to +200; ignore older replies. Actual: PR #266 automated checks cover limits, reset, debounce and stale replies. No separate browser run of every control is recorded. Recorded result: Pass (automated); browser Not run.

- **Results** ? Steps: Read the redesigned stage, tiles and Every application. Expected: After-rise DTI towers, 40%/50% rings and accessible figures. Actual: PR #286 emulator browser preview used sample responses. Towers and labels were checked; this was not a live API calculation. Recorded result: Pass (sample preview).

- **States** ? Steps: Use failed/empty responses and a broker session. Expected: Show error/empty state; refuse broker access. Actual: PR #266 records an ECB timeout showing an error. Tests cover 403, empty state and broker refusal. Recorded result: Pass (recorded error and automated).

- **Hosted call** ? Steps: Run the deployed shock. Expected: Call the API gateway and show a result. Actual: Facts record localhost:5001 failure. PR #288 is open, in review. Successful authenticated hosted re-test: Not run. Recorded result: Fail (deployment fault).
