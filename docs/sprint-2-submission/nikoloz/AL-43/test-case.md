# Test case: AL-43

**Story:** As a broker, I reply to borrower messages from the portal

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-164-broker-inbox` at commit `3e7fa46` (PR #193, open)  
**Re-run:** 15 Nov 2026 on `main` at `f41a283` (after #194 merged), emulators started from main's seed with the al-core API running; no local chain.

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- The al-core API running locally against the emulators (replies go through it).
- Signed in as ciara@test.com (broker), whose client Ben Walsh has `app-approved`, `app-closed` and `app-declined`.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open `/broker/messages`. | One thread per client application, unread threads marked and sorted first. | broker-messages.test.tsx, inboxThreads.test.ts | ☑ Pass ☐ Fail |
| 2 | 2 | Open a thread and send a reply, with the borrower's app open on the same thread. Then send a message from the borrower's app. | The reply shows in the borrower's app within 5 seconds, and the borrower's message shows in the portal without a refresh. | Conversation.test.tsx, messagesService.test.ts, broker-messages.test.tsx | ☐ Pass ☐ Fail |
| 3 | 3 | Sign in as bob@test.com and try to open one of Ben's threads. | Refused. | Backend rules test (al-core, messaging subtask) | ☑ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-164-broker-inbox` at `3e7fa46`, 10 Nov 2026: **598 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- Step 1: the inbox listed Ciara's three client threads (`app-approved`, `app-closed`, `app-declined`). On the local emulator the previews first stayed on "Loading..." because a broker's live listeners on `messages` and `readState` got no answer; after other listeners started they showed. `app-declined` showed "1 unread" with "24 Sept: Sorry Ben, we cannot approve this loan amount on your income...", `app-approved` the underwriter's message, and `app-closed` "No messages yet", sorted unread first. Opening a thread showed the underwriter's message labelled "Bank lending officer". Dumi could not reproduce the listener problem (12 Nov). The unread-first sort is also unit tested (inboxThreads.test.ts, broker-messages.test.tsx).
- Step 2: portal side run on 15 Nov, iOS side not run. Ciara opened the `app-closed` thread and sent "Test reply from Ciara on 15 Nov". It showed in the thread and in the inbox preview, and reading the thread as Ben through Firestore (what the iOS app reads) returned it with sender role broker. A message posted as Ben through `POST /core/applications/app-closed/messages` (the endpoint the iOS app uses) showed in Ciara's open thread 52 ms later, labelled "Borrower", with no refresh. Not run yet: the reply showing in the borrower's iOS app within 5 seconds, which needs the iOS simulator (Ibrahima).
- Step 3: run on 15 Nov against the emulator and the API. Bob reading `app-closed`'s messages through Firestore was refused (403, permission denied by the rules), and Bob posting to that thread through the API got 404 "No application with that id".
