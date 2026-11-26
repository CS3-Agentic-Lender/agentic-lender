# Test case: AL-46

**Story:** As a borrower, I rate and review the app

**Tested by:** Ibrahima Toure  
**Date run:** 17 Nov 2026  
**Build:** #228's branch, with al-core from #218 for `PUT /core/reviews/me`

## Preconditions

- Firebase emulators with the seed data and the gateway running, the app on the iPhone 17 simulator.
- Signed in as Alice (`borrower1`), with no review yet.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open Rate the app from Profile. Try Submit before choosing a star; type a comment over 500 characters. | 1 to 5 stars and an optional comment of up to 500 characters; Submit is disabled until a star is chosen. | ReviewTests (Submit disabled until a star, 500-character limit) | ☑ Pass ☐ Fail |
| 2 | 2 | Choose 4 stars, no comment, and submit. | One review saved in Firestore for the borrower; a thank-you screen. | ReviewTests (PUT and decoding, thanks) | ☑ Pass ☐ Fail |
| 3 | 3 | Edit the review, add a comment and update. | The same review is updated, not a second one added. | ReviewTests (the saved review to update) | ☑ Pass ☐ Fail |
| 4 | 4 | Try to change another borrower's review. | Refused. | `rules.test.js`, `reviews` (backend subtask) | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on #228's branch, iPhone 17 simulator: **710 passed, 0 failed**.

## Notes

- Step 2: thank-you screen; Firestore `reviews/borrower1` = rating 4, comment null. Edit review reopened it with 4 stars, "You reviewed on 17 Nov" and Update review.
- Step 3: added "Greatest app ever created" and updated. The thank-you shows the quote; Firestore has the comment on the same document, `createdAt` unchanged (13:58:50), `updatedAt` 14:01:08.
- Known gap, found in review: the app counts the 500 characters as visible characters and al-core as code points, so a comment full of multi-part emoji can pass the app and be refused by al-core. Logged as AL-317 (needs triage).
