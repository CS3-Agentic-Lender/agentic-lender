# Test case: AL-311

**Story:** As a borrower, I'm told to verify my email after sign-up and can resend the link

**Tested by:** Ibrahima Toure  
**Date run:** 17 Nov 2026 (simulator); 18 Nov 2026 (UI tests)  
**Build:** `feature/AL-311-verify-email-banner` at `83a9dfb`, merged as #244

## Preconditions

- Firebase emulators with the seed data and the gateway running, the app on the iPhone 17 simulator.
- Signed in as a password account whose email isn't verified.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open Home. | The banner with the borrower's email and a Resend email button. | EmailVerificationTests (unverified password account) | ☑ Pass ☐ Fail |
| 2 | 2 | Sign in with a Google-only account, then a verified one. | No banner. | EmailVerificationTests (Google-only, verified) | ☑ Pass ☐ Fail |
| 3 | 3 | Tap Resend email; wait 60 seconds. | A new verification email in the Auth emulator; "Sent. Check your inbox." and no second tap for 60 seconds. | EmailVerificationTests (resend and its 60-second cooldown) | ☑ Pass ☐ Fail |
| 4 | 4 | Make the resend fail. | "We couldn't send the email. Try again in a moment." and the banner stays. | EmailVerificationTests (a failed resend) | ☑ Pass ☐ Fail |
| 5 | 5 | Open the verification link, then send the app to the background and back. | The banner is gone, without a restart. | EmailVerificationTests (hiding after verification) | ☑ Pass ☐ Fail |
| 6 | 6 | Run the unit tests. | All the cases above are covered. | EmailVerificationTests (8) | ☑ Pass ☐ Fail |
| 7 | 7 | Check the Figma Home frames. | The banner and the "Sent" state are shown. | n/a | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`): **724 passed, 0 failed** (17 Nov), and **755 passed, 0 failed** on #244's branch. All 8 end-to-end UI tests pass on the local stack: each signs up a new, unverified borrower, so each meets the banner and gets past it.

## Notes

- Steps 1, 3 and 5 were run on the simulator on 17 Nov; screenshots are on the AL-311 comment of 17 Nov. Resend put a new `VERIFY_EMAIL` for the account in the Auth emulator; 65 seconds later Resend email was back; after opening the link, background and foreground hid the banner in the same app process.
- Steps 2 and 4 are covered by the unit tests only.
- Step 7: [Home: verify email banner](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=434-1886) and [Home: verify email sent](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=434-1948).
- Seeded Alice is verified and Ben isn't (#225), so the demo shows the banner only for Ben.
