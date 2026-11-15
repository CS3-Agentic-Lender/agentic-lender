# Test case: AL-33

**Story:** As an underwriter, I open a loan file with the borrower's full DTI breakdown

**Tested by:** Nikoloz Chilachava  
**Date run:** 28 Oct 2026  
**Build:** `feature/AL-158-loan-file-page` at commit `35a017b` (PR #117), merged into `main` on 29 Oct 2026 as `b8cb08c`  
**Re-run:** 15 Nov 2026 on `main` at `f41a283` (steps 1 to 3), emulators started from main's seed.

## Preconditions

- Firebase emulators started with the DTI seed data from Dumi's PR #121 (the DTI breakdown fields), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as uma@test.com (underwriter) for steps 1 to 3, and as ciara@test.com (broker) for step 4.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for `app-funded`, `app-deliberated` and `app-closed`. | Gross income (per applicant and total), take-home pay, existing debts, living costs, the repayment at the benchmark and stressed rates, DTI and surplus at both rates, and the band for each. | loan-file.test.tsx | ☐ Pass ☑ Fail |
| 2 | 2 | Compare every figure with the stored application and review documents in the Emulator UI, and read the stressed column's label. | Every figure matches the record. The stressed figures are labelled with the stress margin (+2 points). | loan-file.test.tsx | ☑ Pass ☐ Fail |
| 3 | 3 | On the same loan file, look for the borrower details, the property and the collateral panel. | All three are on the same page. | loan-file.test.tsx | ☑ Pass ☐ Fail |
| 4 | 4 | As ciara@test.com, open Alice's `app-funded` by its URL, then her own client Ben's HELOC `app-approved`. | Alice's file is refused. Ben's file opens, with no decision controls. | loan-file.test.tsx | ☑ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-158-loan-file-page` at `35a017b`, 28 Oct 2026: **352 passed, 0 failed**.

## Notes

- Steps 1 and 2: seen in the browser and matched with the seed: `app-funded` DTI 21.6% offered and 26.4% stressed (seed 21.61 and 26.44), surplus €1,516 and €1,161 (seed 1515.50 and 1161.30), DTI band Comfortable, surplus band Comfortable. `app-deliberated`: 36.2% and 41.4%, €835 and €511, Caution and Comfortable. `app-closed`: 24.3% and 29.1%, €533 and €254, Comfortable and Caution. That first run recorded DTI, surplus and the bands only.
- Steps 1 and 2, re-run on 15 Nov on `main`: I re-opened the three files and compared every row of the Debt to income table with the stored `review/underwriting` document read from the emulator. `app-funded`: gross income €7,333 a month (stored 7333.33), take-home €4,900, existing debts €200, living costs €1,800, repayment €1,385 at 4% and €1,739 at 6% (stored 1384.50 and 1738.70). `app-deliberated`: €6,250, €4,300, €1,000, €1,200, repayment €1,265 and €1,589 (stored 1265.15 and 1588.81). `app-closed`: €5,833, €3,950, €150, €2,000, repayment €1,267 and €1,546 (stored 1266.81 and 1546.32). DTI, surplus and both bands matched as on 28 Oct. The stressed column is headed "Stressed (+2 points)", and the table also shows the benchmark rate (4%, September 2026) and "Stress margin +2 points". So step 2 passes.
- Step 1, fail on one part: gross income shows as one combined figure, and the Borrower section says "Applicants: Unavailable". The stored application holds one `grossIncomeEur` and no per-applicant income, so "per applicant" cannot be shown. Everything else in the criterion is on the page.
- Step 3, run on 15 Nov on `main` (the collateral panel PR #188 merged on 13 Nov): the Borrower, Loan, Property, Collateral, Valuation and Debt to income sections are all on the one loan file page, for all three applications.
- Step 4: Ciara saw "Application not available" for Alice's `app-funded`. Ben's HELOC opened with no decision controls, DTI 20.1% and 21%.
- No console errors during the run.
