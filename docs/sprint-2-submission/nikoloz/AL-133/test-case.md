# Test case: AL-133

**Story:** As an underwriter, I see the valuation breakdown in the loan file

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-279-valuation-warnings-and-list` at commit `8047cfb` (PR #187), merged into `main` on 12 Nov 2026 as `b72306c`. The chart itself came in PR #140 (merged 3 Nov).

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as uma@test.com (underwriter).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for `app-funded` and look at the valuation breakdown in the collateral section. | Each feature's contribution in euro, largest first, as a chart going from the baseline to the estimate. | ValuationBreakdown.test.tsx | ☑ Pass ☐ Fail |
| 2 | 2 | Read the chart's label, and compare each row with `valuationDetail` in the stored review in the Emulator UI. | The chart is labelled "compared with a typical listing", and its values match the stored valuation response. | ValuationBreakdown.test.tsx, loan-file.test.tsx | ☐ Pass ☑ Fail |
| 3 | 3 | Add a support warning to `app-funded`'s review in the Emulator UI and reload. Then open `app-approved`, which has none. | The low-support warnings show next to the breakdown; with no warnings, no warning area shows. | loan-file.test.tsx | ☑ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-279-valuation-warnings-and-list` at `8047cfb`, 10 Nov 2026: **467 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- Step 1: `app-funded` showed six rows from the stored list, largest first: Floor area 98 m² +€31,200, County Cork +€18,500, Bedrooms 3 +€9,800, Eircode area T12 +€6,400, Property type Semi-D −€4,600, BER rating C2 −€1,300, going from €306,000 to €366,000. The chart is horizontal bars either side of zero.
- Step 2: the values matched the stored list. Fail on the label: the chart does not say "compared with a typical listing". It says it "Starts from the average of the model's sample homes, not a typical price", because the baseline is the average over the model's background sample, not a typical listing. The wording needs to be agreed with Nic and the criterion updated, or the label changed.
- Step 3: the added warning showed under "Why this estimate may be less reliable". `app-approved` showed no warning area.
- Extra check: with `baselineEur` and `contributions` set to null on `app-declined` in the Emulator UI, the file showed "The breakdown of this estimate isn't available." and kept the €258,000 estimate.
- The emulator edits were made by hand. Re-import the seed data to reset them.
- No console errors during the run.
