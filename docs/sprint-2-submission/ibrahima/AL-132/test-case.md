# Test case: AL-132

**Story:** As a borrower, I see how each detail of the house moved its estimated price

**Tested by:** Ibrahima Toure  
**Date run:** 6 Nov 2026  
**Build:** `main` at commit `66e32f0`

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core and al-ai running locally, the app on the iPhone 17 simulator. Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as alice@test.com. Open Check a property.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Check the reference property used in the AI tests. | Each detail's contribution in euro with a + or − sign, largest first. | ValuationBreakdownTests: TheLargestDetailComesFirstWhateverOrderTheyArriveIn, EachRowSaysWhichWayItMovedTheEstimate | ☑ Pass ☐ Fail |
| 2 | 2 | Read the first row and add up the list. | Labelled "Starting point", never a typical price. Starting point plus contributions equals the estimate. | ValuationBreakdownTests: TheBaselineIsCalledTheStartingPointNeverATypicalPrice, RoundedRowsAreNudgedToAddUpToTheShownEstimate | ☑ Pass ☐ Fail |
| 3 | 3 | Call /valuation with the same inputs and compare. | The same numbers as the response. | Manual comparison | ☑ Pass ☐ Fail |
| 4 | 4 | Use a response with no breakdown (unit test fixture). | The section is hidden and the rest of the result still works. | ValuationBreakdownTests.HiddenWhenTheAnswerHasNoBreakdown, ValuationSummaryTests.WithoutABreakdownTheRestOfTheResultIsUnchanged | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on `main` at `66e32f0`, iPhone 17 simulator (iOS 26.5), 6 Nov 2026: **651 passed, 0 failed, 0 skipped**. The UI tests named above (`AgenticLenderUITests`) need the emulators running and were not part of this run.

## Notes

- Steps 1 and 2: on the AL-22 Cork check, the list starts at "Starting point €577,000, average of the model's sample homes" (not a typical price), then −93k, −93k, −90k, −30k, +13k, −11k, largest first, adding up to the €273,000 shown.
- Step 3: compared with POST /ai/valuation for the same inputs. Every row is within €1,000 of the response. Two rows differ from plain rounding: floor area −89,496 shows as −€90,000 and BER +13,601 as +€13,000. Plain rounding would add up to €275,000, so the app nudges the rows closest to the rounding line to make the list add up to the estimate (criterion 2, unit test RoundedRowsAreNudgedToAddUpToTheShownEstimate).
- Step 4: covered by the unit tests (HiddenWhenTheAnswerHasNoBreakdown, WithoutABreakdownTheRestOfTheResultIsUnchanged), which passed in the run above; the live endpoint always returns a breakdown, so it was not tried by hand.
<!-- TODO (Ibrahima): rewrite these notes in your own words. -->
