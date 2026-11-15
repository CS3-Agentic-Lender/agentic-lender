# Test case: AL-196

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

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the pipeline queue and set the loan type filter to HELOC. | Every row shows its loan type, and the filter shows only HELOC applications. | pipeline-queue.test.tsx | ☑ Pass ☐ Fail |
| 2 | 2 | Open the loan file for `app-approved`. | The estimated value (indicative), the existing balance, the requested limit, combined LTV and the 80% cap, and no asking price comparison. | HelocCollateral.test.tsx, loan-file.test.tsx | ☑ Pass ☐ Fail |
| 3 | 3 | On the same file, read the DTI breakdown and the Committee section. | Both work the same as for a mortgage. | loan-file.test.tsx, CommitteeConsole.test.tsx | ☑ Pass ☐ Fail |
| 4 | 4 | Add `CLTV_CAP` to the review's stored breaches in the Emulator UI and reload. | The "requires lender exception review" condition shows clearly. | HelocCollateral.test.tsx | ☑ Pass ☐ Fail |
| 5 | 5 | Sign off, mint and download the audit pack for the HELOC. | They work as for a mortgage and show the loan type. | SignOffPanel.test.tsx, loan-file.test.tsx, AuditPackActions.test.tsx, auditExports.test.ts | ☐ Pass ☑ Fail |

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
