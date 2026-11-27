# Test case: AL-333

**Story:** As an underwriter, I read a loan file whose committee and loan note are shown as clear 3D views of the stored data

**Tested by:** Nikoloz Chilachava (recorded evidence)  
**Evidence cut-off:** 26 Nov 2026  
**Build:** origin/main at ebcfa88, except work marked open, in review.

## Preconditions

- Sign in as an underwriter; open seeded mortgage, HELOC and funded files.
- Use merged PR #280. Brokers retain outcome and conditions without committee reasoning.

## Steps

| # | Criterion | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | "Every figure and label comes from stored data; nothing is invented, and missing data says "not stored" rather than a guess." | Compare figures, votes, labels, hashes and missing fields with stored records. | Stored facts only; missing values explicitly not stored. | PR #280 seeded mortgage/HELOC/funded browser checks and field tests passed; stored mint labels shown. Real-run Macro source re-test remains Not run; no claim of a real-run source browser Pass. | Pass |
| 2 | "Sign-off, minting, the audit pack and messaging behave exactly as before; a broker sees no decision controls." | Repeat sign-off, mint, audit download and messaging; inspect a broker loan file. | Existing flows unchanged; broker has no decision controls. | 26 Nov browser check on main ebcfa88 (Auth/Firestore emulators, seeded data): signed in as the seeded broker, app-deliberated and app-funded loan files show no Approve, Decline, sign-off or mint controls and no committee tabs or votes; the funded file shows the decision ("Approved on 18 Sept 2026"), the loan note and the audit pack download buttons. The underwriter view of app-deliberated still shows Approve, Decline and Message borrower. Sign-off, minting, audit pack download and messaging were NOT re-run: they call the al-core API (and minting needs Hardhat), which was not running locally. Evidence: evidence/1-broker-loan-file-no-decision-controls.png. | Partly (broker view Pass; sign-off, mint, audit pack and messaging Not run) |
| 3 | "A pillar click and the tabs open the same agent's details; the tabs work with the arrow, Home and End keys." | Click agent pillars; navigate tabs with arrows, Home and End. | Pillar and tab select the same agent; documented keyboard behaviour. | PR #280 records pillar-to-tab browser Pass and keyboard-tab automated checks. Re-checked 26 Nov on main ebcfa88 (Chromium, app-deliberated as underwriter): Tab from "Run details" lands on the selected tab; ArrowRight moved Affordability to Valuation to Strategist, ArrowLeft back to Valuation, End to Policy gate, Home to Affordability, ArrowLeft from the first tab wrapped to Policy gate; each time the matching panel was shown and labelled by its tab, with a 3px focus outline. Clicking the Valuation, Strategist and Affordability pillars in the 3D stage selected the same agent's tab. Evidence: evidence/2-committee-tabs-keyboard.png, evidence/5-pillar-click-opens-valuation-tab.png. | Pass |
| 4 | "The 3D views pause off screen, free their resources when you leave the page, and do not block page scrolling on a phone." | Move scenes off screen, leave the page and scroll over scenes on a phone. | Pause, release resources and allow phone scrolling. | PR documents lifecycle and phone scrolling. Chromium 375px browser check passed with no sideways scroll/errors; real phone and non-Chromium were explicitly not checked. 26 Nov browser check on main ebcfa88 (Chromium, frame requests counted with an injected requestAnimationFrame counter): with the committee stage on screen the count rose 37, 44, 54, 62; with it scrolled 2,600px off screen it stayed at 72 across four rendered frames (paused). Leaving the loan file for Overview removed the canvas from the page and its WebGL context reported lost (freed). At 375px with touch emulation the canvas has touch-action pan-y, the page has no sideways scroll (scrollWidth 375), and scrolling with the pointer over the stage moved the page 300px. A real phone, a real touch swipe and non-Chromium browsers were not checked. Evidence: evidence/4-committee-3d-on-screen.png, evidence/6-phone-375-page-scrolled-over-stage.png. | Pass (Chromium, phone emulation) |
| 5 | "Without WebGL the page shows the same facts as text and nothing breaks." | Disable WebGL and inspect the same file as text. | All stored facts remain readable without failure. | 26 Nov browser check on main ebcfa88: WebGL was switched off in the page (canvas getContext returns null for webgl, set before opening the loan file so the canDraw3d probe ran fresh and failed). app-deliberated: no 3D stage, the six committee tabs, votes and recommendation still shown as text. app-funded: no 3D chain stage; the Loan note card still shows token #6, network "Not recorded", mint date, the three plain points, the mint transaction, contract, audit hash and "Not recorded" audit registry transaction. No page errors or unhandled rejections. Evidence: evidence/3-no-webgl-loan-note-text.png. | Pass |
| 6 | "npm test and npm run build pass, and the page is checked in the browser on the emulators." | Review recorded npm test/build and emulator browser checks. | Tests/build pass; loan page checked on emulators. | PR #280: 780 tests/34 files, tsc and build passed. Facts record 792 after review and approval by Ibrahima/Nic. Mortgage/HELOC/funded browser checks passed. No new application tests run for this document correction. | Pass |
| 7 | "The team has agreed at standup whether brokers see the committee before this merges." | Check the recorded standup access decision. | Team agrees broker visibility before merge. | 23 Nov team decision: committee underwriters only; brokers see outcome and conditions. This supersedes the older PR body discussion. | Pass |

## Automated test run

PR #280: npx tsc -b clean; npm test 780 passed in 34 files; npm run build passed; betterleaks clean. Facts record 792 tests after review and approvals by Ibrahima and Nic; later command output is not supplied.

## Notes

Merged 23 Nov at 23:55, 3efeea3. The 23 Nov team decision supersedes the old broker-access wording in the PR body. Current main also permits read-only admins. Parent Epic is not supplied.

Rows 2 to 5 also carry new browser checks run on 26 Nov 2026 against main at ebcfa88 (Vite dev server, Firebase Auth and Firestore emulators with the seeded data, Chromium in the Claude desktop browser pane, signed in as the seeded underwriter and broker). The pane was not on screen, so animation frames ran only while a screenshot was being taken; the frame counts in row 4 come from those frames. Screenshots are in `evidence/`. The other rows are recorded checks, not new application test runs during submission preparation. Criterion wording is quoted from the supplied verbatim Jira acceptance-criteria file; results distinguish browser, preview, automated and code-audit evidence.

## Earlier grouped checks retained as evidence

These preserve the previously recorded results and unrun checks; their former row numbers were not Jira criterion numbers. They do not replace the criterion table above.

- **Council** ? Steps: Open Committee; click a pillar. Expected: Voting agents, Macro observer, recommendation, policy gate and matching tab. Actual: PR #280 records seeded-emulator browser checks on mortgage, HELOC and funded files; pillar clicks opened agent tabs. Recorded result: Pass (browser).

- **Text details** ? Steps: Use keyboard tabs; read reports, sources and calls. Expected: Accessible text and stored fields. Actual: PR #280 records keyboard, market-source and call-field tests. Real-run source re-test not recorded. Recorded result: Pass (automated); real-run re-test Not run.

- **Loan note** ? Steps: Open a funded Loan note. Expected: Only this loan records highlighted, with stored hashes and valid Amoy links. Actual: PR #280 browser check saw stored mint transaction labels. Explorer links and close records have tests. Recorded result: Pass (browser and automated).

- **Small screen** ? Steps: Open at 375px; then use a real phone and another browser. Expected: No sideways scrolling; text remains usable. Actual: PR #280: no sideways scroll at 375px; no console errors. Real phone and non-Chromium explicitly not checked. Recorded result: Pass (Chromium 375px); phone/other browsers Not run.

- **Lifecycle** ? Steps: Disable WebGL, leave the page and enable reduced motion. Expected: Retain text facts; stop motion and release resources. Actual: PR describes fallback and lifecycle. 26 Nov browser check (see criteria 4 and 5): WebGL off keeps the text facts; leaving the page removes the canvas and loses its context; off screen the loop stops. Reduced motion was not exercised on the loan file (only on the rate shock page, AL-348). Recorded result: Pass (WebGL off, leave page, pause off screen); reduced motion Not run.

- **Timeline** ? Steps: Read Closed after a declined decision. Expected: Timeline preserves declined outcome. Actual: Facts record Ibrahima finding and fix 40813ee. 26 Nov browser check: the seed has no application Closed after a Declined decision, so that exact case could not be opened. app-declined shows "Underwriter decision: Stopped here, Funding: Not reached"; app-closed (approved, token #7) shows all four steps Done. Recorded result: Partly (declined timeline Pass; Closed-after-Declined Not run, no seeded case).
