# Test case: AL-41

**Story:** As an underwriter, I simulate a house price downturn and see the change in portfolio LTVs

**Tested by:** Nikoloz Chilachava (recorded evidence)  
**Evidence cut-off:** 26 Nov 2026  
**Build:** origin/main at ebcfa88, except work marked open, in review.

## Preconditions

- PR #289 is open, in review; its page is not on origin/main at ebcfa88.
- Recorded browser preview: emulators and sample responses, not a real al-ai run.

## Steps

| # | Criterion | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | "A slider sets a price fall from 0% to 40% in steps of 5, and the chart updates within 1 second of receiving a successful backend result." | On the PR #289 preview, move the 0-40% slider in steps of 5 and time rendering after success. | Valid range/step; chart updates within 1 second after success. | PR #289 automated tests cover slider, presets, keyboard, boundaries and reset. Emulator sample preview at -10% passed. Response-to-chart timing and a real API run are Not run; PR #289 remains open. | Partly |
| 2 | "The chart shows the count and total loan amount above 80% and above 90% LTV, before and after the fall." | Read counts and loan amounts above 80% and 90% before and after the fall. | Both counts and total loan amounts at both thresholds before and after. | Sample preview: 4 tested, above 80% 3 -> 3, above 90% 1 -> 2, EUR 370,000 above 90% after. Towers show after-fall LTV with 80%/90% rings. Recorded layout has counts before/after and amount above 90% after, not all before/after amounts at both thresholds. | Partly |
| 3 | "A table lists the loans that cross 90% LTV, each linking to its loan file." | Read Loans crossing 90% and follow each loan-file link. | Crossing loans listed with correct loan-file links. | PR #289 sample preview showed LN-1003 at 90.00% -> 100.00% with a link. Tests cover crossing links and exact 80%/90% boundaries. | Pass |

## Automated test run

PR #289: 61 new tests; npm test 1159-1161 passed per run. One to three files timed out under load and passed alone. tsc -b, npm run build and betterleaks clean. These are open-branch results.

## Notes

No merged portal delivery yet. Backend Done is not a test of this page. LTV is indicative and model based, not a verified valuation.

These are recorded checks, not new application test runs during submission preparation. Criterion wording is quoted from the supplied verbatim Jira acceptance-criteria file; results distinguish browser, preview, automated and code-audit evidence.

## Earlier grouped checks retained as evidence

These preserve the previously recorded results and unrun checks; their former row numbers were not Jira criterion numbers. They do not replace the criterion table above.

- **Results** ? Steps: Open /underwriter/stress/house-prices; choose -10%. Expected: Show tested count, threshold counts and exposure. Actual: PR #289 sample preview: 4 tested; above 80% 3 to 3; above 90% 1 to 2; EUR 370,000 above 90% after. Recorded result: Pass (sample preview).

- **Controls** ? Steps: Use slider, presets 0/-10/-20/-30/-40 and reset. Expected: Allow 0-40% in steps of 5; reset to -10%. Actual: PR #289 records slider, preset, keyboard, boundary and reset tests. Recorded result: Pass (automated).

- **Crossing loans** ? Steps: Read Loans crossing 90%; open its link. Expected: List loans moving from at most 90% to above 90%. Actual: Sample preview: LN-1003 at 90.00% to 100.00% with a link. Tests cover links and exact 80%/90% boundaries. Recorded result: Pass (preview and automated).

- **Fallback** ? Steps: Read stage/table; remove WebGL. Expected: After-fall LTV towers; controls and tables remain; show indicative-value warning. Actual: PR #289 records no-WebGL and tower-click tests. Separate manual fallback run: Not run. Recorded result: Pass (automated); manual fallback Not run.

- **States** ? Steps: Use loading, failed, empty and 403 responses; delay an old reply. Expected: Show correct state; ignore stale replies. Actual: PR #289 records automated state coverage. Separate real-service failure run: Not run. Recorded result: Pass (automated); real-service check Not run.

- **Real API** ? Steps: Send a real downturn request and repeat hosted after merge. Expected: Use POST /ai/portfolio/downturn and display its figures. Actual: Not run. Browser evidence fed in sample results. PR #289 and shared live URL fix #288 are open, in review. Recorded result: Not run.
