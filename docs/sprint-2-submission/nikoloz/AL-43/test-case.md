# Test case: AL-43

**Story:** As a broker, I reply to borrower messages from the portal

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-164-broker-inbox` at commit `3e7fa46` (PR #193, open)

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- The al-core API running locally against the emulators (replies go through it).
- Signed in as ciara@test.com (broker), whose client Ben Walsh has `app-approved`, `app-closed` and `app-declined`.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open `/broker/messages`. | One thread per client application, unread threads marked and sorted first. | broker-messages.test.tsx, inboxThreads.test.ts | ☑ Pass ☐ Fail |
| 2 | 2 | Open a thread and send a reply, with the borrower's app open on the same thread. Then send a message from the borrower's app. | The reply shows in the borrower's app within 5 seconds, and the borrower's message shows in the portal without a refresh. | Conversation.test.tsx, messagesService.test.ts, broker-messages.test.tsx | ☐ Pass ☐ Fail |
| 3 | 3 | Sign in as bob@test.com and try to open one of Ben's threads. | Refused. | Backend rules test (al-core, messaging subtask) | ☐ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-164-broker-inbox` at `3e7fa46`, 10 Nov 2026: **598 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- Step 1: the inbox listed Ciara's three client threads (`app-approved`, `app-closed`, `app-declined`). On the local emulator the previews first stayed on "Loading..." because a broker's live listeners on `messages` and `readState` got no answer; after other listeners started they showed. `app-declined` showed "1 unread" with "24 Sept: Sorry Ben, we cannot approve this loan amount on your income...", `app-approved` the underwriter's message, and `app-closed` "No messages yet", sorted unread first. Opening a thread showed the underwriter's message labelled "Bank lending officer". Dumi could not reproduce the listener problem (12 Nov). The unread-first sort is also unit tested (inboxThreads.test.ts, broker-messages.test.tsx).
- Step 2: Not run yet: a broker reply in the browser, delivery to the borrower's iOS app within 5 seconds, and a borrower message arriving in the portal. Sending through al-core and the live thread are unit tests only (Conversation.test.tsx, messagesService.test.ts).
- Step 3: Not run yet by me. The rule that a broker reads only their own clients' threads is al-core's (Firestore rules and the messages endpoints).
