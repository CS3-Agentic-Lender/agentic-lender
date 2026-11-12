# Test case: AL-33

**Story:** As an underwriter, I open a loan file with the borrower's full DTI breakdown

**Tested by:** Nikoloz Chilachava  
**Date run:** 28 Oct 2026  
**Build:** `feature/AL-158-loan-file-page` at commit `35a017b` (PR #117), merged into `main` on 29 Oct 2026 as `b8cb08c`

## Preconditions

- Firebase emulators started with the DTI seed data from Dumi's PR #121 (the DTI breakdown fields), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as uma@test.com (underwriter) for steps 1 to 3, and as ciara@test.com (broker) for step 4.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for `app-funded`, `app-deliberated` and `app-closed`. | Gross income (per applicant and total), take-home pay, existing debts, living costs, the repayment at the benchmark and stressed rates, DTI and surplus at both rates, and the band for each. | loan-file.test.tsx | ☐ Pass ☐ Fail |
| 2 | 2 | Compare every figure with the stored application and review documents in the Emulator UI, and read the stressed column's label. | Every figure matches the record. The stressed figures are labelled with the stress margin (+2 points). | loan-file.test.tsx | ☐ Pass ☐ Fail |
| 3 | 3 | On the same loan file, look for the borrower details, the property and the collateral panel. | All three are on the same page. | loan-file.test.tsx | ☐ Pass ☐ Fail |
| 4 | 4 | As ciara@test.com, open Alice's `app-funded` by its URL, then her own client Ben's HELOC `app-approved`. | Alice's file is refused. Ben's file opens, with no decision controls. | loan-file.test.tsx | ☑ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-158-loan-file-page` at `35a017b`, 28 Oct 2026: **352 passed, 0 failed**.

## Notes

- Steps 1 and 2: seen in the browser and matched with the seed: `app-funded` DTI 21.6% offered and 26.4% stressed (seed 21.61 and 26.44), surplus €1,516 and €1,161 (seed 1515.50 and 1161.30), DTI band Comfortable, surplus band Comfortable. `app-deliberated`: 36.2% and 41.4%, €835 and €511, Caution and Comfortable. `app-closed`: 24.3% and 29.1%, €533 and €254, Comfortable and Caution. Not run yet: the record of this run covers DTI, surplus and the bands only. To run: re-open the three files and compare gross income per applicant and total, take-home pay, debts, living costs, both repayments and the stress margin label with the seed.
- Step 3: Not run yet: on `main` the collateral section is still a placeholder; the mortgage collateral panel comes with the collateral panel PR (#188, open). To run: once #188 merges, check that borrower details, property and collateral panel are on one page.
- Step 4: Ciara saw "Application not available" for Alice's `app-funded`. Ben's HELOC opened with no decision controls, DTI 20.1% and 21%.
- No console errors during the run.
