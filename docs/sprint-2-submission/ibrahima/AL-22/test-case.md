# Test case: AL-22

**Story:** As a borrower, I enter property specs (county, size, bedrooms, type, BER) and get a fair valuation

**Tested by:** Ibrahima Toure  
**Date run:** 6 Nov 2026  
**Build:** `main` at commit `66e32f0`

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core and al-ai running locally, the app on the iPhone 17 simulator. Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as alice@test.com. Open Check a property.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Look at the form fields and pickers. | County (26 counties), floor area in m², bedrooms, property type, BER (old A1 to G, new A to G, Don't know) and an optional asking price. | PropertyCheckValidatorTests.EmptyFormAsksForEveryRequiredFieldButNotTheAskingPrice, BERRatingTests | ☑ Pass ☐ Fail |
| 2 | 2 | Enter Cork, 110 m², 3 bedrooms, semi-detached, B3, no asking price. Tap Check. | An estimate to the nearest €1,000, labelled "estimate based on 2024 asking prices", with any low-support warning. | ValuationSummaryTests: EstimateIsToTheNearestThousandAndSaysWhatItIsBasedOn, WarningsAreShownAsTheEndpointWordsThem | ☑ Pass ☐ Fail |
| 3 | 3 | Repeat with an asking price far above the estimate, then one close to it. | Over-priced when the model flags the price, Fair otherwise. | ValuationSummaryTests: AFlaggedAskingPriceIsOverPriced, AnUnflaggedAskingPriceAboveTheEstimateIsFair | ☑ Pass ☐ Fail |
| 4 | 4 | Save the check, then open the application form and pick a saved check. | The check is in the saved list and fills the application's home details. | UI: SavedCheckUITests.ASavedCheckFillsTheApplicationsHome | ☑ Pass ☐ Fail |
| 5 | 5 | Enter floor area 0 and leave county empty. Then stop al-ai and tap Check. | An error under each bad field. With the service down, a message with Retry, and Retry works once al-ai is back. | PropertyCheckViewModelTests: AnErrorShowsUnderItsFieldOnceItIsLeft, AnUnreachableServiceShowsAMessageAndRetryWorks | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on `main` at `66e32f0`, iPhone 17 simulator (iOS 26.5), 6 Nov 2026: **651 passed, 0 failed, 0 skipped**. The UI tests named above (`AgenticLenderUITests`) need the emulators running and were not part of this run.

## Notes

- Step 2: Cork, 110 m², 3 bed, semi-detached, B3 (Eircode A64) gave €273,000, labelled "Estimate based on 2024 asking prices, to the nearest €1,000. Not a valuation.", with the model's warning that it has not seen Eircode area A64.
- Step 3: €400,000 asking price showed Over-priced ("€127,000 (47%) above the estimate, so the model flags it for review"); €280,000 showed Fair ("€7,000 (3%) above the estimate, which the model doesn't flag").
- Step 4: Save this property showed "Saved to your properties" and the check was in Firestore under the borrower (al-core answered 201). In the application form, Use a saved property filled the Eircode, county, asking price, type, size and bedrooms. Address line 1 stays empty, as a check has no street address.
- Step 5: floor area 0 and no county showed an error under each field and Check value stayed off. With al-ai stopped, the app showed "We couldn't value this property right now. Try again in a moment." with a Try again button (the criterion says Retry); after al-ai was started again, Try again gave the estimate.
- Step 1: the form has county, Eircode, size in m², bedrooms, property type, BER and an optional asking price. The BER picker lists "I don't know", the new scale (A0, A to G) and the old one (A1 onwards).
- Seen while testing: when the screen is scrolled, the large title slides under the status bar and the back button overlaps it (also on the application form). Cosmetic.
