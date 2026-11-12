# Test case: AL-31

**Story:** As a borrower, I see my estimated LTV, DTI and approval likelihood

**Tested by:** Ibrahima Toure  
**Date run:** 6 Nov 2026  
**Build:** `main` at commit `66e32f0`  
**Step 2 run again:** 10 Nov 2026, on the build from PR #196 (commit `f778244`, before it merged), and 12 Nov 2026 on `main` at `fe6d110`, after #196 merged

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core and al-ai running locally, the app on the iPhone 17 simulator. Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as ben@test.com; run on his declined application `app-declined`, which has seeded figures. Note: the backend write on submit (AL-63) was not merged at the time of the 6 Nov run, so the figures came from the seeded application.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the submitted application. | LTV and DTI as percentages and approval likelihood as High, Medium, Low or Unknown. | LoanFiguresTests: APurchaseReadsItsPurchasePriceLTV, EveryLikelihoodLabelIsRead | ☑ Pass ☐ Fail |
| 2 | 2 | Read the text under each figure. | Each figure has a one-line plain-English explanation. | LoanFiguresTests: EachFigureHasAPlainExplanation, EveryExplanationIsOneSentence | ☑ Pass ☐ Fail |
| 3 | 3 | Look at the approval likelihood. | It is labelled "indicative" and is never a percentage. | LoanFiguresTests: APercentageForLikelihoodIsNeverShown, LikelihoodIsLabelledIndicativeInItsTone | ☑ Pass ☐ Fail |
| 4 | 4 | With the screen open, change `approvalLikelihood` or `dtiPct` in the Emulator UI. | The card updates without a refresh. | ApplicationStatusViewModelTests.TheFiguresUpdateLiveWithTheRecord | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on `main` at `66e32f0`, iPhone 17 simulator (iOS 26.5), 6 Nov 2026: **651 passed, 0 failed, 0 skipped**. The UI tests named above (`AgenticLenderUITests`) need the emulators running and were not part of this run.

On the PR #196 build (`f778244`), 10 Nov 2026: **654 passed, 0 failed, 0 skipped**, including `EveryExplanationIsOneSentence`, which is new in that PR.

On `main` at `fe6d110`, after #196 merged, 12 Nov 2026: **654 passed, 0 failed, 0 skipped**.

## Notes

- Ran on `app-declined` because Alice's submitted application had no figures yet (the backend write on submit, AL-63, was still in progress on 6 Nov). Home shows the newest-created application, so its `createdAt` was set to 6 Oct for the run and put back to 20 Sep after.
- Step 1: LTV 90.7% (limit 90%), DTI 50.8% of income, likelihood Low. The LTV shown is `purchaseLtvPct`; the older `ltvPct` field (95) is not read, as the ticket names `purchaseLtvPct`.
- Step 2: the explanations are in the "What do these mean?" sheet. On 6 Nov this step failed: the likelihood explanation ran to about four lines against the criterion's "one-line". The explanations were then cut to one sentence each (subtask AL-303, PR #196). "One-line" is read as one sentence, because one sentence can still wrap to two lines on a phone.
- Step 2, run again on 10 Nov on the PR #196 build: on Alice's `app-applied` (mortgage, likelihood Unknown) the sheet read "Your loan as a share of the property price.", "Your monthly debts, including this loan, as a share of your monthly income before tax." and "We can't estimate this yet because some details are missing." On Ben's `app-approved` (HELOC, High) it read "What you still owe plus the credit line, as a share of your home's estimated value." and "An indicative guide to how likely approval looks from your application's figures, not a decision." The tiles still showed limit 90% and limit 80%. Pass. For this run `app-approved` had its `createdAt` set to 6 Oct in the emulator, which is not saved.
- Step 2, run again on 12 Nov on `main` at `fe6d110`. In review after the 10 Nov run, the Unknown sentence was changed to say the valuation may not be ready. On Alice's `app-applied` (mortgage, likelihood Unknown) the sheet read "Your loan as a share of the property price.", "Your monthly debts, including this loan, as a share of your monthly income before tax." and "We can't estimate this yet: either some details are missing or your home's valuation isn't ready." The LTV tile still showed limit 90%. Pass. Ben's HELOC was not run again; its two sentences did not change after 10 Nov.
- Step 4: changed `dtiPct` 50.8 → 42.0 and `approvalLikelihood` Low → Medium in the emulator; the tiles and the open sheet updated within 5 seconds with no refresh. Put back afterwards. A change made by the backend itself (an edit or a committee re-run) was not tested in this run.
- On a HELOC (`app-approved`) the first tile reads Combined LTV 57.8% against the 80% limit, as designed.
- Since this run: the backend write on submit merged on 9 Nov (#185). These steps were not run again on a freshly submitted application.
