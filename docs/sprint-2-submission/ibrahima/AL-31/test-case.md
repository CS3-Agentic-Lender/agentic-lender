# Test case: AL-31

**Story:** As a borrower, I see my estimated LTV, DTI and approval likelihood

**Tested by:** Ibrahima Toure  
**Date run:** 6 Nov 2026  
**Build:** `main` at commit `66e32f0`

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core and al-ai running locally, the app on the iPhone 17 simulator. Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as ben@test.com; run on his declined application `app-declined`, which has seeded figures. Note: the backend write on submit (AL-63) is not merged yet, so the figures come from the seeded application until it is.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the submitted application. | LTV and DTI as percentages and approval likelihood as High, Medium, Low or Unknown. | LoanFiguresTests: APurchaseReadsItsPurchasePriceLTV, EveryLikelihoodLabelIsRead | ☑ Pass ☐ Fail |
| 2 | 2 | Read the text under each figure. | Each figure has a one-line plain-English explanation. | LoanFiguresTests.EachFigureHasAPlainExplanation | ☑ Pass ☐ Fail |
| 3 | 3 | Look at the approval likelihood. | It is labelled "indicative" and is never a percentage. | LoanFiguresTests: APercentageForLikelihoodIsNeverShown, LikelihoodIsLabelledIndicativeInItsTone | ☑ Pass ☐ Fail |
| 4 | 4 | With the screen open, change `approvalLikelihood` or `dtiPct` in the Emulator UI. | The card updates without a refresh. | ApplicationStatusViewModelTests.TheFiguresUpdateLiveWithTheRecord | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on `main` at `66e32f0`, iPhone 17 simulator (iOS 26.5), 6 Nov 2026: **651 passed, 0 failed, 0 skipped**. The UI tests named above (`AgenticLenderUITests`) need the emulators running and were not part of this run.

## Notes

- Ran on `app-declined` because Alice's submitted application has no figures yet (the backend write on submit is AL-63, still in progress). Home shows the newest-created application, so its `createdAt` was set to 6 Oct for the run and put back to 20 Sep after.
- Step 1: LTV 90.7% (limit 90%), DTI 50.8% of income, likelihood Low. The LTV shown is `purchaseLtvPct`; the older `ltvPct` field (95) is not read, as the ticket names `purchaseLtvPct`.
- Step 2: the explanations are in the "What do these mean?" sheet. The likelihood one runs to about four lines rather than one; still one short plain explanation.
- Step 4: changed `dtiPct` 50.8 → 42.0 and `approvalLikelihood` Low → Medium in the emulator; the tiles and the open sheet updated within 5 seconds with no refresh. Put back afterwards. A change made by the backend itself (an edit or a committee re-run) is tested once AL-63 lands.
- Also seen on a HELOC (`app-approved`): the first tile reads Combined LTV 57.8%, limit 80%, instead of the purchase LTV.
