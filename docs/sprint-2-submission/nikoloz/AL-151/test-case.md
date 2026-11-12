# Test case: AL-151

**Story:** As an underwriter, I sign off an application and my decision is recorded

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-165-sign-off-panel` at commit `4723898` (PR #189, open; review fix `e4a2dd9` pushed on 12 Nov)

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- The al-core API running locally against the emulators.
- Signed in as uma@test.com (underwriter).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for `app-deliberated` (AI Deliberated). | The sign-off panel shows the committee's effective recommendation and offers Approve and Decline, with a required justification. | SignOffPanel.test.tsx, loan-file.test.tsx | ☑ Pass ☐ Fail |
| 2 | 2 | Type a justification, choose Approve and confirm. Check the application in the Emulator UI. | The decision, the underwriter's ID, the time and the justification are saved, and the status moves to Underwriter Approved. | SignOffPanel.test.tsx, apiClient.test.ts | ☑ Pass ☐ Fail |
| 3 | 3 | Open the same kind of file as a broker. Try to write a decision as a broker. | Brokers never see the sign-off controls, and a broker's decision write is refused (rules test). | loan-file.test.tsx, SignOffPanel.test.tsx; backend rules test (al-core) | ☐ Pass ☐ Fail |
| 4 | 4 | Choose the outcome that differs from the AI recommendation. | The form asks the underwriter to say why. | SignOffPanel.test.tsx, loan-file.test.tsx | ☑ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-165-sign-off-panel` at `4723898`, 10 Nov 2026: **480 passed, 0 failed**. After the review fix `e4a2dd9`, 12 Nov 2026: **484 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- Step 1: the panel showed the AI recommendation Approve as advice, a required justification and Approve and Decline.
- Step 2: the confirmation listed the application, borrower, outcome and justification. One `POST /core/applications/app-deliberated/decision` returned 200. Firestore saved status Underwriter Approved and `decision` with outcome approved, `underwriterId` underwriter1, `decidedAt` and `reason`, plus a `statusHistory` entry AI Deliberated to Underwriter Approved with actor underwriter. The page showed "Decision recorded: Approved. Saved status: Underwriter Approved." No console errors.
- Step 3: the broker never seeing the panel is unit tests only (loan-file.test.tsx, SignOffPanel.test.tsx). Not run yet by me: the rules test. Firestore has no write rule, so every write goes through the al-core API, which refuses a broker with 403; that test is al-core's.
- Step 4: unit tests only (SignOffPanel.test.tsx, loan-file.test.tsx). On an override the confirmation shows "You are going against the AI recommendation." The justification is required for every decision, not only an override.
- The sign-off changes the emulator data (`app-deliberated` stays Underwriter Approved). Re-import the seed data to reset it.
