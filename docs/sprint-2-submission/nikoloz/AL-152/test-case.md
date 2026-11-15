# Test case: AL-152

**Story:** As an underwriter, I reply to a borrower's messages as the bank lending officer

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-167-underwriter-message-borrower` at commit `68fca96` (PR #194, open)  
**Re-run:** 15 Nov 2026 on `main` at `f41a283` (after #194 merged), emulators started from main's seed with the al-core API running; no local chain.

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- The al-core API running locally against the emulators (messages are sent through it).
- Signed in as uma@test.com (underwriter).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for `app-approved`, click "Message borrower" and send a message. Then sign in as ciara@test.com and open the same thread. | The borrower's thread opens and the message is sent, marked "Bank lending officer". | loan-file.test.tsx, Conversation.test.tsx, messagesService.test.ts | ☑ Pass ☐ Fail |
| 2 | 2 | Sign in to the borrower's iOS app as Ben Walsh and open Messages. | Ben sees the message in the same thread, labelled with the sender's role. | Mobile (AL-42) | ☐ Pass ☐ Fail |
| 3 | 3 | Post to a thread as an underwriter, as the client's broker and as another broker. | Underwriters can post to any borrower's thread, brokers only to their own clients' threads (rules test). | Backend rules test (al-core, messaging subtask) | ☑ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-167-underwriter-message-borrower` at `68fca96`, 10 Nov 2026: **601 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- Step 1: "Message borrower" opened Ben Walsh's thread ("No messages yet."). I sent "Hi Ben, your HELOC note has been minted. A surveyor will be in touch about the valuation.", which showed at once as "You, 10 Nov, 09:45". Firestore stored it with `senderRole` underwriter and `senderId` underwriter1, both set by the API from the token. In Ciara's broker view it showed labelled "Bank lending officer".
- Step 2: Not run yet: checking the message in Ben's thread in the iOS app on the simulator.
- Step 3: run on 15 Nov against the API. The underwriter (uma@test.com) posted to `app-closed` (Ciara's client) and to `app-deliberated` (Bob's client): both 201. Ciara posted to her own client's thread from the portal (AL-43 step 2). Bob posting to `app-closed` got 404 "No application with that id".
- The message stays in the emulator data. Re-import the seed data to reset it.
