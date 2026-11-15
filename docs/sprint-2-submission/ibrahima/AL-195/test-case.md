# Test case: AL-195

**Story:** As a homeowner, I apply for a home equity line of credit against my property's value

**Tested by:** Ibrahima Toure  
**Date run:** 6 Nov 2026  
**Build:** `main` at commit `66e32f0`

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core and al-ai running locally, the app on the iPhone 17 simulator. Seeded logins use the demo password from `al-core/scripts/seed.js`.
- A new borrower account made for this run (Alice already has a submitted mortgage, which blocks a HELOC application). Open What can I borrow?.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Choose HELOC. | The HELOC check opens. (Going back and choosing Mortgage gives the unchanged mortgage check.) | LoanTypeTests | ☑ Pass ☐ Fail |
| 2 | 2 | Enter Cork, 110 m², 3 bedrooms, semi-detached, B3, €150,000 balance, €70,000 income, €300 monthly debts, 20 years. | No deposit or asking price asked for. | HELOCCheckValidatorTests.EmptyFormAsksForEveryField | ☑ Pass ☐ Fail |
| 3 | 3 | Tap Calculate. | The maximum credit line and what limited it, labelled indicative, matching the affordability endpoint. | HELOCCheckViewModelTests.CalculateSendsTheFormAndShowsTheAnswer | ☑ Pass ☐ Fail |
| 4 | 3 | Enter a balance at or above 80% of the value. | A €0 line and a message that there is no equity to borrow against. | HELOCCheckViewModelTests.ANoEquityAnswerIsStillAResult | ☑ Pass ☐ Fail |
| 5 | 4 | Tap Start application, then submit. | The form is pre-filled with no deposit field. Saved with `loanType: heloc` and status Applied, and a reference shows. | HELOCApplicationTests: StartsFromTheHELOCCheck, TheBodyHasTheHELOCFieldsAndNoDepositOrAskingPrice | ☑ Pass ☐ Fail |
| 6 | 5 | Read the labels on each HELOC screen. | "Estimated value", never "asking price". | HELOCApplicationTests.AHELOCNeedsNoAskingPrice | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on `main` at `66e32f0`, iPhone 17 simulator (iOS 26.5), 6 Nov 2026: **651 passed, 0 failed, 0 skipped**. The UI tests named above (`AgenticLenderUITests`) need the emulators running and were not part of this run.

## Notes

- Steps 1 and 2: choosing HELOC opened the HELOC check; the form asked for the house details, balance, income, debts and term, and no deposit or asking price.
- Step 3: Cork, 110 m², 3 bed, semi-detached, B3, €150,000 balance, €70,000 income, €300 debts, 20 years gave a maximum line of €59,883, "Limited by equity (80% of the estimated value, less what you owe)", estimated value €262,354, €362.88 a month fully drawn and €429.02 at +2 points, labelled "Indicative, not an offer". POST /ai/affordability with the same inputs returned 262,353.72, 59,882.97, 362.88, 429.02 and limited_by equity, so they match.
- Step 4 (no equity): a €220,000 balance gave a €0 line and "No equity available. You owe 80% or more of the estimated value, so there's nothing to borrow against yet."
- Step 5: Start application, then submit, showed "Application submitted" with Ref 0uG43XL5; Firestore has `0uG43XL5RqWwoqvGCu65` with `loanType: heloc`, status Applied, the €150,000 balance, and no deposit or asking price.
- Step 6: the HELOC screens say "Estimated value of your home", never asking price.
- The estimate (€262k) is lower than the property check's €273k for the same house because the HELOC check doesn't take an Eircode.
