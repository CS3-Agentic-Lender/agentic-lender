# Test case: AL-349

**Story:** As an underwriter, I read a tighter loan file with no empty boxes and the affordability figures shown

**Tested by:** Nikoloz Chilachava (recorded evidence)  
**Evidence cut-off:** 26 Nov 2026  
**Build:** origin/main at ebcfa88, except work marked open, in review.

## Preconditions

- Open merged loan files as an underwriter, with and without stored valuation/affordability figures.
- Missing figures remain missing.

## Steps

| # | Criterion | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | "No card renders a large empty area when its data is missing." | Open cards with missing data. | No large empty card area. | PR #287 automated collapsed-card and page tests passed. No separate missing-card browser result recorded; remains Not run. | Pass |
| 2 | "Empty concerns and conditions show the single line; non-empty lists show as before." | Compare empty and populated concerns/conditions. | Single empty line; existing lists retained. | PR #287 automated single-line check passed; No concerns or conditions raised. Non-empty lists use existing rendering. | Pass |
| 3 | "Run details open and close by keyboard and mouse, and the IDs can be copied." | Toggle Run details by keyboard/mouse and copy stored IDs. | Disclosure works and ID copying succeeds. | PR #287 automated disclosure/copy checks passed; no separate full manual interaction run supplied. | Pass |
| 4 | "Affordability figures come from the stored run; a missing figure says it is not stored." | Inspect affordability values and a record with missing fields; verify their source. | Values associated with the stored run; missing values explicitly not stored. | Missing-field/figure tests passed. PR #287 explicitly says the run does not store calculations: values come from review.dtiBreakdown, application.dtiPct and run policy-gate breaches, disclosed on screen. Thus the literal stored-run source criterion is only partly covered. Review d65bb1d fixes stale failed-run figures, one DTI source and surplus; browser re-test Not run. | Partly |
| 5 | "The logo returns to the Overview from any page." | Click the logo from each role page. | Correct role Overview opens. | PR #287 automated role-link checks passed; logo stays plain for other roles. Separate every-page browser run not recorded. | Pass |
| 6 | "npm test and npm run build pass, and the loan file is checked in the browser on the emulators." | Review recorded npm test/build and emulator browser evidence. | Tests/build pass and loan file checked in emulator browser. | PR #287: 1042 tests/53 files, tsc/build/leak scan clean; initial timeout passed alone. No separate Sprint 3 emulator browser result supplied, and loading/review-fix browser re-tests remain Not run. | Partly |

## Automated test run

PR #287: npm test 1042 passed in 53 files on rebased branch. One initial timeout passed alone. tsc -b, npm run build and betterleaks clean. No later full-suite count supplied for d65bb1d.

## Notes

Merged 26 Nov, 9a9a18f. Figures come from review and run policy gate, not calculations stored in the run; the screen explains this. Parent Epic not supplied.

These are recorded checks, not new application test runs during submission preparation. Criterion wording is quoted from the supplied verbatim Jira acceptance-criteria file; results distinguish browser, preview, automated and code-audit evidence.

## Earlier grouped checks retained as evidence

These preserve the previously recorded results and unrun checks; their former row numbers were not Jira criterion numbers. They do not replace the criterion table above.

- **Valuation** ? Steps: Read missing valuation. Expected: One-line notice; Collateral fills row. Actual: PR #287 records collapsed-card and full-page tests. No separate browser result supplied. Recorded result: Pass (automated); browser Not run.

- **Empty lists** ? Steps: Read agent with empty concerns/conditions. Expected: One No concerns or conditions raised line. Actual: PR #287 records the empty-line test. Recorded result: Pass (automated).

- **Run details** ? Steps: Open Run details; copy an ID. Expected: Disclosure and stored ID copy. Actual: PR #287 records disclosure/copy tests. Recorded result: Pass (automated).

- **Affordability** ? Steps: Read Affordability, also with missing fields. Expected: Repayment, DTI/40%, stressed DTI/50%, surplus, breaches; Not stored for missing. Actual: PR #287 records figure/missing-value tests. Review d65bb1d fixes DTI source, surplus and stale failed-run figures. Recorded result: Pass (automated); review-fix browser re-test Not run.

- **Loading** ? Steps: Delay review loading, then fail a re-run. Expected: No layout jump or stale figures. Actual: Facts record fixes; separate browser re-test Not run. Recorded result: Not run (browser).

- **Home link** ? Steps: Click header logo as each role. Expected: Broker/underwriter role Overview; plain logo for other roles. Actual: PR #287 records role-link tests. Recorded result: Pass (automated).
