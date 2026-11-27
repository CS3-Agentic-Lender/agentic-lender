# Test case: AL-347

**Story:** As an underwriter or broker, I land on an Overview that shows my work queue and key figures

**Tested by:** Nikoloz Chilachava (recorded evidence)  
**Evidence cut-off:** 26 Nov 2026  
**Build:** origin/main at ebcfa88, except work marked open, in review.

## Preconditions

- Use seeded emulators as Uma (underwriter), then Bob (broker).
- PR #285 is merged. Seed records without statusHistory cannot supply history-based counts/feed.

## Steps

| # | Criterion | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | "Every number and row comes from stored data for the signed-in user; nothing is invented." | Compare both Overview pages with signed-in-user stored data. | Only stored-user figures and rows. | PR #285 browser: Uma 1 / 0 / 0 / 79.6% across 5; Bob 2 / 1 / 1 / 1 unread. Fixture tests cover figures. Populated real-history browser feed remains Not run; seed history feed was empty. | Pass |
| 2 | "An underwriter sees the underwriter Overview and a broker sees only their own clients' data." | Sign in as Uma, then Bob; inspect role and data scope. | Underwriter Overview; broker own clients only. | Both emulator pages checked; tests cover broker isolation. Every broker query carries brokerId. | Pass |
| 3 | "Each list row opens the right loan file or client." | Follow decision, attention and activity list links. | Correct loan file or client destination. | Browser showed Alice Byrne in Needs your decision / Needs attention; automated list-order and link checks passed. Populated real-history browser feed remains Not run. | Pass |
| 4 | "Loading, empty and error states each render without layout jumps." | Exercise loading, empty and failed queries. | Stable loading, empty and error layout. | PR #285 tests cover these states and broker isolation. Review fix 443474d refreshes time per snapshot and waits for all listeners. No separate manual measurement of layout movement supplied. | Pass |
| 5 | "Clicking the logo returns to the Overview from any page." | Click the header logo from each role page. | Role Overview opens. | Delivered by merged AL-349 PR #287; automated role-logo link checks passed. Separate every-page browser navigation run not supplied. | Pass |
| 6 | "npm test and npm run build pass, and both pages are checked in the browser on the emulators." | Review recorded npm test/build and both emulator pages. | Tests/build pass; both pages browser checked. | PR #285: 1053 tests/56 files, tsc/build/leak scan clean. Both seeded emulator pages checked. No post-review count supplied. | Pass |

## Automated test run

PR #285: npm test 1053 passed in 56 files at PR open; tsc -b, npm run build and betterleaks clean. No post-review count supplied.

## Notes

Merged 26 Nov, a36c7d2. Missing seed statusHistory leaves weekly approval/activity empty. Parent Epic not supplied.

These are recorded checks, not new application test runs during submission preparation. Criterion wording is quoted from the supplied verbatim Jira acceptance-criteria file; results distinguish browser, preview, automated and code-audit evidence.

## Earlier grouped checks retained as evidence

These preserve the previously recorded results and unrun checks; their former row numbers were not Jira criterion numbers. They do not replace the criterion table above.

- **Figures** ? Steps: Open underwriter Overview. Expected: Four role figures. Actual: PR #285 browser: 1 awaiting decision / 0 AI running / 0 approved this week / 79.6% average LTV across 5. Recorded result: Pass (browser).

- **Work queue** ? Steps: Read Needs your decision; follow its link. Expected: AI Deliberated applications, oldest first. Actual: Browser showed Alice Byrne; tests cover order and links. Recorded result: Pass (browser and automated).

- **Activity** ? Steps: Read Recent activity. Expected: Newest statusHistory first. Actual: Tests cover fixtures. Seed feed empty; populated real-history browser check is Not run. Recorded result: Pass (automated); populated browser feed Not run.

- **Broker view** ? Steps: Open broker Overview. Expected: Active, awaiting AI, approved, unread and Needs attention. Actual: PR #285 browser: Bob 2 / 1 / 1 / 1 unread; Alice Byrne under Needs attention. Recorded result: Pass (browser).

- **Isolation** ? Steps: Check broker isolation, loading, empty and error states. Expected: Only own clients; wait for listeners. Actual: Tests cover isolation/states. Review fix 443474d refreshes time per snapshot and waits for every listener. Recorded result: Pass (automated).
