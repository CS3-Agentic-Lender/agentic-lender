# Test case: AL-196

## Sprint 3 update

Evidence cut-off: 26 Nov 2026. Facts record all five criteria met on main, and the story and web subtask set Done on 26 Nov (comments 10954 and 10953). The 17 Nov main re-run passed the mint/audit/type-display gap recorded as Fail in step 5 below. Browser HELOC sign-off remains untested: the seed was already approved.

| # | Criterion | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | "The pipeline queue shows the loan type and can be filtered by it." | Open the pipeline and filter by HELOC. | Loan type column and working type filter. | Historical browser: all 7 types shown, HELOC filter 1 of 7. Supplied facts confirm on main. New browser run Not run. | Pass |
| 2 | "A HELOC loan file shows the estimated value (indicative), the existing balance, the requested limit, combined LTV and the 80% cap, and no asking price comparison." | Read a HELOC collateral panel. | Indicative estimated value, balance, limit, combined LTV, 80% cap; no asking-price comparison. | Historical browser: EUR 415,000 indicative estimate, EUR 180,000 balance, EUR 60,000 limit, CLTV 57.8%, 80% cap; no asking-price row. Facts confirm main. | Pass |
| 3 | "The DTI breakdown and the AI deliberation console work the same as for a mortgage." | Read HELOC DTI and the shared committee as an underwriter. | Same DTI and deliberation components as a mortgage. | Historical browser: DTI 20.1%/21% and shared committee. Facts confirm main. Real committee-content re-test is still needed under AL-30. | Pass |
| 4 | "A cap breach shows the "requires lender exception review" condition clearly." | Inspect a stored CLTV_CAP breach. | Requires lender exception review displayed clearly. | Historical manual emulator edit showed the CLTV_CAP warning; supplied facts confirm main also retains the surveyor condition. | Pass |
| 5 | "Sign-off, mint and the audit pack work as for a mortgage and show the loan type." | Sign off a HELOC, mint and download its audit pack; inspect loan type. | Mortgage-equivalent flow and HELOC type shown. | Mint/export and type-display re-run passed on main on 17 Nov, superseding the old missing-type Fail. Browser HELOC sign-off remains Not run because the seeded HELOC was already approved. PR #206: 721 suite tests, focused 96, build and leak scan passed. | Partly |

Merged PR #206 supplies the type row. Its evidence: 721 tests passed, fresh focused run 96 passed, npm run build passed and betterleaks clean. No new suite count supplied for the 17 Nov browser re-run.

The old failure below remains as history; the update above is the current outcome. Sprint 3 changed the layout, so a new low-fidelity wireframe is supplied.

## Sprint 2 record

The historical steps and outcomes below are retained. The Actual result column summarises the original notes.

**Story:** As an underwriter, I review a HELOC application with its combined LTV and collateral value

**Tested by:** Nikoloz Chilachava  
**Date run:** 29 Oct 2026 (step 1) and 10 Nov 2026 (steps 2 to 5)  
**Build:** step 1 on the HELOC queue and collateral work merged into `main` on 30 Oct 2026 (PR #141); steps 2 to 5 on `feature/AL-213-heloc-policy-conditions` at commit `d5acc93` (PR #190, merged on 12 Nov)  
**Re-run:** 15 Nov 2026 (step 5) with `main` at `f41a283` for the emulators and the al-core API, and a local Hardhat node.

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- For step 5: the al-core API running locally against the emulators, and a local Hardhat node with the contracts deployed (`npm run deploy:local` in `al-core/chain`).
- Signed in as uma@test.com (underwriter). The seeded HELOC is `app-approved` (Ben Walsh, broker ciara@test.com).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Actual result | Result |
|---|---|---|---|---|---|---|
| 1 | 1 | Open the pipeline queue and set the loan type filter to HELOC. | Every row shows its loan type, and the filter shows only HELOC applications. | pipeline-queue.test.tsx | 7 types shown; HELOC filter 1 of 7. | Pass |
| 2 | 2 | Open the loan file for `app-approved`. | The estimated value (indicative), the existing balance, the requested limit, combined LTV and the 80% cap, and no asking price comparison. | HelocCollateral.test.tsx, loan-file.test.tsx | CLTV 57.8%, 80% cap, no asking price. | Pass |
| 3 | 3 | On the same file, read the DTI breakdown and the Committee section. | Both work the same as for a mortgage. | loan-file.test.tsx, CommitteeConsole.test.tsx | DTI 20.1%/21%; shared committee. | Pass |
| 4 | 4 | Add `CLTV_CAP` to the review's stored breaches in the Emulator UI and reload. | The "requires lender exception review" condition shows clearly. | HelocCollateral.test.tsx | CLTV_CAP warning after emulator edit. | Pass |
| 5 | 5 | Sign off, mint and download the audit pack for the HELOC. | They work as for a mortgage and show the loan type. | SignOffPanel.test.tsx, loan-file.test.tsx, AuditPackActions.test.tsx, auditExports.test.ts | Mint/export worked; type row missing on main; sign-off not run. | Fail |

## Automated test run

al-web Vitest on `feature/AL-213-heloc-policy-conditions` at `d5acc93`, 10 Nov 2026: **494 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- Step 1: all 7 seeded applications showed a loan type, and the HELOC filter showed 1 of 7 (29 Oct).
- Step 2: estimated value €415,000 labelled "indicative estimate of a 2024 asking price, not a valuation", existing balance €180,000, credit limit €60,000, combined LTV 57.8% against the 80% cap. No asking price row. Conditions listed "Requires an independent surveyor's valuation (HELOC)".
- Step 3: the DTI breakdown showed 20.1% and 21%. The Committee section showed the HELOC's run with the same console as a mortgage; the console's own gaps are in the AL-30 test case.
- Step 4: with `CLTV_CAP` added by hand, "Requires lender exception review: the combined LTV is above the 80% cap (CLTV_CAP)." showed in the conditions.
- Step 5: the mint and the audit pack worked on this HELOC (AL-37 and AL-38 test cases: token id 2, and the CSV holds `loan_type` `heloc`). Sign-off uses the same panel as a mortgage; `app-approved` is already Underwriter Approved in the seed, so sign-off was not run on a HELOC in the browser. Fail: the Loan note card does not show the loan type yet.
- Step 5, re-run on 15 Nov: still a fail on `main`, where the Loan note card has no loan type row for any loan (the panel never had one, so mortgages are missing it too). The fix is on the branch `feature/AL-213-loan-note-loan-type` (commit `82444c1`, not merged yet): the card gets a "Loan type" row filled from the application's stored `loanType`, the same value the mint puts on the note. On that branch I minted `app-approved` on a local chain and the card showed "Loan type: HELOC" with token id 1; the seeded mortgages `app-funded` and `app-closed` showed "Loan type: Mortgage"; and the audit pack for the HELOC came back with `loan_type` `heloc` and `verified` true. al-web Vitest on the branch: 721 passed, 0 failed, and the build passed. This step passes once that branch is merged.
- The emulator edits were made by hand. Re-import the seed data to reset them.
