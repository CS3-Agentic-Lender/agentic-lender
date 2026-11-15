# Test case: AL-23

**Story:** As an underwriter, I compare the seller's asking price against the model's valuation

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-155-collateral-panel` at commit `6515234` (PR #188, open)  
**Re-run:** 15 Nov 2026 on `main` at `f41a283` (after #194 merged), emulators started from main's seed with the al-core API running; no local chain.

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as uma@test.com (underwriter).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for `app-funded`, then for `app-deliberated` after setting its review's `priceNeedsReview` to true in the Emulator UI. | The collateral section shows the asking price, the model estimate and the signed gap as a percentage. The "Price needs review" badge shows only when the model flags it. | MortgageCollateral.test.tsx, loan-file.test.tsx | ☑ Pass ☐ Fail |
| 2 | 2 | On the same two loan files, read the LTV rows. | Purchase-price LTV and indicative model-based LTV side by side, each against the 90% limit. | MortgageCollateral.test.tsx | ☑ Pass ☐ Fail |
| 3 | 3 | On `app-funded`, read the label under the estimate and the area next to it. | The estimate is labelled as an estimate based on 2024 asking prices, with the low-support warning next to it. | MortgageCollateral.test.tsx | ☑ Pass ☐ Fail |
| 4 | 4 | Compare the figures on every seeded mortgage application with its stored application and review documents in the Emulator UI. | Every value matches the stored record. | MortgageCollateral.test.tsx | ☑ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-155-collateral-panel` at `6515234`, 10 Nov 2026: **484 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- Step 1: `app-funded` showed asking price €365,000, model estimate €366,000, Model v2, "Asking price 0.3% below the estimate" and no badge. `app-deliberated`, with `priceNeedsReview` set to true by hand, showed the "Price needs review" badge and "Asking price 1.3% above the estimate".
- Step 2: `app-funded` showed purchase-price LTV 79.5% and indicative LTV 79.2%; `app-deliberated` showed 85.5% and 86.6%. Both against the 90% limit.
- Step 3: the label reads "indicative estimate of a 2024 asking price, not a valuation", not the criterion's exact words. The support warning showed next to it on `app-funded`. `app-deliberated` has no warnings, and no warning area showed.
- Step 4: re-run on 15 Nov on all six seeded mortgage applications (`app-applied`, `app-closed`, `app-declined`, `app-deliberated`, `app-draft`, `app-funded`). For each, the asking price, model estimate, gap, model version and both LTVs on the screen matched the stored application and `review/underwriting` documents (read from the emulator), and no "Price needs review" badge showed because every stored `priceNeedsReview` is false. `app-declined` showed "Above the 90% limit" on both LTVs (90.7% and 95%). `app-applied` and `app-draft` have no review yet and showed "The model estimate will appear once the underwriting review is written." with "Gap unavailable".
- The `priceNeedsReview` edit was made by hand in the Emulator UI. Re-import the seed data to reset it.
- No console errors during the run.
