# Test case: AL-21

**Story:** As a borrower, I see the current status of my application

**Tested by:** Ibrahima Toure  
**Date run:** 6 Nov 2026  
**Build:** `main` at commit `66e32f0`

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core and al-ai running locally, the app on the iPhone 17 simulator. Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as alice@test.com, who has a submitted application.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the application from Home. | A vertical timeline of Draft, Applied, AI Deliberated, Underwriter Approved or Declined, Funded, Closed. Finished steps show the date they were reached. | StatusTimelineTests: FinishedStepsShowTheDateTheyWereReached and the per-status tests | ☑ Pass ☐ Fail |
| 2 | 2 | With the status screen open, change the application's `status` to the next state in the Emulator UI (localhost:4000). | The screen shows the new status within 5 seconds, with no refresh. | UI: LiveStatusUITests.StatusScreenShowsANewStatusWithoutARefresh; unit: ApplicationStatusViewModelTests.AStatusChangeShowsWithoutARefresh | ☑ Pass ☐ Fail |
| 3 | 3 | Sign in as ben@test.com and open the declined application. | The Declined step shows the reason the underwriter gave. | StatusTimelineTests: ADeclineWithAReasonShowsIt, ADeclineWithoutAReasonHasNoReasonLine | ☑ Pass ☐ Fail |
| 4 | 4 | With the status screen open, turn off the Mac's network (or stop the emulators). | The last known status stays on screen with an "Offline" banner. Turning the network back on removes the banner. | ApplicationStatusViewModelTests: LosingThePhonesConnectionShowsTheBannerOverTheLastStatus, TheBannerGoesWhenTheConnectionComesBack | ☑ Pass ☐ Fail |
| 5 | 5 | Compare each status badge with the portal's badge for the same status. | Same names and palette A colours. | StatusTimelineTests.OnlyTheCurrentStepHasABadgeInItsStatusColour | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on `main` at `66e32f0`, iPhone 17 simulator (iOS 26.5), 6 Nov 2026: **651 passed, 0 failed, 0 skipped**. The UI tests named above (`AgenticLenderUITests`) need the emulators running and were not part of this run.

## Notes

- Step 2: the status was changed by hand in the Emulator UI (`app-applied`, Applied → AI Deliberated), so the new step had no date and showed "Now". It was set back to Applied afterwards.
- Step 3: Home shows the newest-created application, so Ben's declined one (`app-declined`) was brought forward by setting its `createdAt` to 6 Oct, then put back to 20 Sep. That edit is why its Draft date read 6 Oct.
- Step 4: turned the Mac's Wi-Fi off with the status screen open; the Offline banner showed over the last status and went when Wi-Fi came back.
- Step 5: compared the app's status badges with the portal's (signed in as bob@test.com on localhost:5173); names and colours match.
