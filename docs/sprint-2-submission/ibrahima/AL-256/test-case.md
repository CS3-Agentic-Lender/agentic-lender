# Test case: AL-256

**Story:** iOS: sign out from Your details

**Tested by:** Ibrahima Toure  
**Date run:** 6 Nov 2026  
**Build:** `main` at commit `66e32f0`

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core and al-ai running locally, the app on the iPhone 17 simulator. Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Emulators running. `noprofile@test.com` made in the Auth emulator with no profile in Firestore, and a new Google account (`newgoogle@test.com`) added through the emulator's Google screen.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Continue with Google as a first-time user. Then sign in as a user with no profile from the home gate. | Your details shows a Sign out button both times. | ProfileDetailsViewModelTests.SignOutIsOfferedBeforeAnythingIsSaved | ☑ Pass ☐ Fail |
| 2 | 2 | Tap Sign out. | Signed out of Firebase and Google, Welcome opens, no profile saved (check the Emulator UI). | AppSessionTests.SignOutGoesBackToWelcomeAndStartsTheScreensAfresh, plus the Emulator UI check | ☑ Pass ☐ Fail |
| 3 | 3 | Make sign-out fail (unit test fake). | Your details stays open and says why. | AppSessionTests.AFailedSignOutStaysPutAndSaysSo | ☑ Pass ☐ Fail |
| 4 | 4 | Fill in the form, tap Continue and look at Sign out while it saves. | Sign out is off while saving. | ProfileDetailsViewModelTests.SignOutIsOffWhileContinueIsSavingTheProfile | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on `main` at `66e32f0`, iPhone 17 simulator (iOS 26.5), 6 Nov 2026: **651 passed, 0 failed, 0 skipped**. The UI tests named above (`AgenticLenderUITests`) need the emulators running and were not part of this run.

## Notes

- Step 1, home gate: signing in as `noprofile@test.com` got 404 from GET /core/me and opened Your details with Sign out under Continue.
- Step 1, Google: Continue with Google with a new emulator account opened Your details ("Signed in as newgoogle@test.com") with Sign out under Continue.
- Step 2: Sign out went back to Welcome both times. No profile was saved: al-core got only GET /core/me (404) during the run and no request to create one, and `noprofile@test.com` has no users document in Firestore.
- Steps 3 and 4 (a failed sign-out, and Sign out being off while Continue saves) were checked by the unit tests named above, which passed in the run above; they can't be made to happen by hand on the emulators.
<!-- TODO (Ibrahima): rewrite these notes in your own words. -->
