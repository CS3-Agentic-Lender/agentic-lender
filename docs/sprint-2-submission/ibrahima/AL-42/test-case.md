# Test case: AL-42

**Story:** As a borrower, I message my assigned broker or lending officer in the app

**Tested by:** Ibrahima Toure  
**Date run:** 6 Nov 2026  
**Build:** `main` at commit `66e32f0`

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core and al-ai running locally, the app on the iPhone 17 simulator. Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Signed in as alice@test.com, whose broker is bob@test.com.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open Messages and send "Hello". | One thread with the assigned broker. The message shows straight away and is saved in Firestore. | MessageInboxTests: ASentMessageShowsStraightAwayWhileItSends, OnceFirestoreHasTheMessageItShowsOnce | ☑ Pass ☐ Fail |
| 2 | 2 | Reply as bob@test.com from the portal while the app is on another tab, then open Messages. | The reply arrives within 5 seconds; an unread badge shows until the thread is opened. | MessageInboxTests: ListensToTheBorrowersApplicationAndShowsNewMessagesAsTheyArrive, LeavingTheThreadClearsTheBadgeAndTheDivider | ☑ Pass ☐ Fail |
| 3 | 3 | Stop al-core and send a message, then start al-core and tap it. | Marked "Not sent: tap to try again"; tapping sends it. | MessageInboxTests.AFailedSendIsMarkedNotSentAndTappingSendsItAgain | ☑ Pass ☐ Fail |
| 4 | 4 | Try to read another borrower's thread. | Refused. | Backend rules test (al-core, messaging subtask), plus a check on the emulators | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on `main` at `66e32f0`, iPhone 17 simulator (iOS 26.5), 6 Nov 2026: **651 passed, 0 failed, 0 skipped**. The UI tests named above (`AgenticLenderUITests`) need the emulators running and were not part of this run.

## Notes

- Step 1: Messages opened one thread, with Bob Murphy (Your broker · Murphy Mortgages). "Hello Bob" showed at once under Today and was saved in Firestore under `app-applied/messages`.
- Step 2: Home showed a "1 new" badge for the seeded unread reply. A new reply from Bob (sent through POST /core/applications/app-applied/messages as bob@test.com) made the badge show again on Home within 5 seconds; opening the thread showed it under a New messages divider, and back on Home the badge was gone and Firestore had it as read.
- Step 3: with al-core stopped, "Alpha 123" showed greyed with "Not sent. Tap to try again". After al-core was started, tapping it sent it, and Firestore has it once (no duplicate).
- Step 4: signed in as ben@test.com, reading Alice's messages straight from Firestore is refused by the security rules (PERMISSION_DENIED), and al-core answers 404 to his unread count and to sending on her thread.
- The criterion's wording is "Not sent: tap to try again"; the app says "Not sent. Tap to try again".
<!-- TODO (Ibrahima): rewrite these notes in your own words. -->
