# Test case: AL-45

**Story:** As a borrower, I submit a support request from the app

**Tested by:** Ibrahima Toure  
**Date run:** 17 Nov 2026  
**Build:** #221 rebased onto `main` with #216 merged (steps 1, 2 and 4); #221's branch before #216 merged, so with no endpoint to reach (step 3)

## Preconditions

- Firebase emulators started with the seed data, al-core and al-ai running locally through the gateway, the app on the iPhone 17 simulator.
- Signed in as Alice (`borrower1`), who has an application (`app-applied`).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the support form and tap Send with every field empty; open the category list. | Category (Application, Payment, Account, Other), subject and message are all required. | SupportFormTests (required fields, spaces-only text, the four categories) | ☑ Pass ☐ Fail |
| 2 | 2 | Fill in the form and send. | The request is saved in Firestore with the borrower's ID, and a confirmation shows a reference number and "We'll reply within 2 working days". | SupportRequestTests (the POST and its decoding) | ☑ Pass ☐ Fail |
| 3 | 3 | Send with no endpoint to reach. | The message is kept and a retry button shows. | SupportRequestTests (failed send keeps the text) | ☑ Pass ☐ Fail |
| 4 | 4 | Try to read another borrower's request. | Refused. | `rules.test.js`, `support_requests` (backend subtask) | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on #221's branch, iPhone 17 simulator: **700 passed, 0 failed**.

## Notes

- Step 1: Send on an empty form outlined all three fields with "Choose a category", "Add a subject" and "Tell us what's happening". The category sheet lists Account, Application, Payment and Other.
- Step 2: sent "Not available" (Account) with the application reference switched on → "Request sent", reference `SR-AUBYDB7C`, stored in `support_requests` for `borrower1` with `applicationId` `app-applied` and status `open`. The confirmation reads "Thanks, we've received your request SR-AUBYDB7C and will reply within 2 working days."
- Step 3 (before the endpoint merged): the text stayed, with "We couldn't send your request. Check your connection and try again." The button reads "Try again", as in Figma 21a, rather than "Retry".
- Step 4: own request readable, someone else's refused (Dumi's rules test).
