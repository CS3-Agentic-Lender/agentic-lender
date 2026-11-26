# Test case: AL-313

**Story:** As a borrower, I move around the app with a tab bar (Home, Property, Messages, Profile)

**Tested by:** Ibrahima Toure  
**Date run:** 18 Nov 2026 (unit and UI tests); 24 Nov 2026 (steps 1 to 6 on the simulator)  
**Build:** #237's branch, with the amount field fix (#229); `main` at `3efeea3` for the simulator run

## Preconditions

- Firebase emulators with the seed data and the gateway running, the app on the iPhone 17 simulator.
- 24 Nov: a new borrower signed up during the run (Tab Test, a made-up account on the emulator), broker Bob Murphy.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Sign in; tap each tab; open a screen inside a tab. | Home, Property, Messages and Profile each open their screen; the bar stays on pushed screens. | MainTabsTests (tab selection) | ☑ Pass ☐ Fail |
| 2 | 2 | Look at Welcome, sign-in, sign-up, Your details during sign-up, and a sheet. | No tab bar. | UI tests (sign-up flow) | ☑ Pass ☐ Fail |
| 3 | 3 | Go into a screen in one tab, switch tabs and back. | The first tab is where it was left. | MainTabsTests | ☑ Pass ☐ Fail |
| 4 | 4 | Have an unread message, then read it. | Unread count as a badge on Messages; hidden at 0. | MainTabsTests (badge, hidden at 0) | ☑ Pass ☐ Fail |
| 5 | 5 | Open Home; tap "Check a property". | No Messages card, broker card, Sign out or person icon; the Property tab opens. | MainTabsTests | ☑ Pass ☐ Fail |
| 6 | 6 | Sign out; then submit an application and tap Return home. | Welcome; then the Home tab from its first screen. | MainTabsTests (Home reset after submitting) | ☑ Pass ☐ Fail |
| 7 | 7 | Run the unit tests and the UI tests on the local stack. | Both pass with the new navigation. | MainTabsTests; AgenticLenderUITests (8) | ☑ Pass ☐ Fail |
| 8 | 8 | Check the Figma frames are linked. | The frames with the tab bar are linked. | n/a | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on #237's branch, iPhone 17 simulator: **738 passed, 0 failed**. All 8 end-to-end UI tests pass on the local stack (amount fields, check a property from the form, live status, loan note, saved check, submit an application).

## Notes

- **Steps 1 to 6, run on 24 Nov** (screenshots kept with the run):
  - Step 2: no tab bar on Welcome, Create account (step 1 of 2), Your details (step 2 of 2), the County sheet, or Choose your broker.
  - Step 5: Home shows the greeting, the verify-email banner, the application card and Get started; no Messages card, broker card, Sign out or person icon. "Check a property" switched to the Property tab.
  - Step 1: Home, Property ("Properties"), Messages (Bob Murphy, "No application yet" before applying) and Profile each open their screen. The Check a property form opened inside the Property tab with the bar still showing.
  - Step 3: Bedrooms set to 4 on that form, then Messages, then Property: the form was still open with 4 bedrooms.
  - Step 6: after submitting an application (ref klMxwlex), Back to home showed Home's first screen with the new application card. Sign out from Profile went to Welcome.
  - Step 4: with a message from Bob unread, the Messages tab showed a red **1**; after reading it, the badge was gone.
- **Bug found in step 4:** straight after submitting an application, Bob's first message showed **no badge** for 13 seconds. The badge appeared for his second message once the borrower had signed out and in again. Cause: the tab view starts listening for messages once, when it first appears, and a new borrower has no application then, so nothing listens until the Messages tab is opened or the borrower signs in again. Logged as AL-335 (needs triage).
- Step 7: the UI tests were updated for the tab bar: `goBackToHome` taps the Home tab, and taps first move the target clear of the floating bar. Before the amount field fix, those tests failed about 2 runs in 5; after it, all 8 passed.
- Step 8 (Figma, linked on the AL-313 comment of 18 Nov): [Tab bar component](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=15-154), [Home](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=4-52), [09 Saved checks](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=5-377), [15 Thread](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=7-413), [15e Unread](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=8-2), [19 Profile](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=8-408).
- Added mid-sprint on 16 Nov (comment on the ticket): 54 Figma frames showed a tab bar that no ticket covered.
