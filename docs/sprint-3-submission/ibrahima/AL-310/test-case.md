# Test case: AL-310

**Story:** As a borrower, I see whether a message came from my broker or the bank's lending officer

**Tested by:** Ibrahima Toure  
**Date run:** 16 Nov 2026  
**Build:** #208's branch

## Preconditions

- Firebase emulators with the seed data and the gateway running, the app on the iPhone 17 simulator.
- Signed in as Alice, whose broker is Bob Murphy. Messages sent with real `POST /core/applications/{id}/messages` calls as Uma (underwriter) and Bob (broker).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Send a message as Uma, then open Messages. | "Bank lending officer" above the bubble. | MessageSenderTests (underwriter) | ☑ Pass ☐ Fail |
| 2 | 2 | Send a message as Bob. | The broker's name, or "Broker" if it isn't known. | MessageSenderTests (broker, name unknown) | ☑ Pass ☐ Fail |
| 3 | 3 | Send two messages in a row as Uma. | The label shows once, above the first. | MessageSenderTests (label once per run, again after a new day) | ☑ Pass ☐ Fail |
| 4 | 4 | A message with a role the app doesn't know. | It still shows, with no label. | MessageSenderTests (unknown role) | ☑ Pass ☐ Fail |
| 5 | 5 | Look at the Home messages card and the thread header after Uma has written. | Neither implies every reply is from the broker. | MessageSenderTests (Home, header and composer wording) | ☑ Pass ☐ Fail |
| 6 | 6 | Check the unit tests and the Figma messages frames. | Each sender role is covered; the frames show the label. | MessageSenderTests (12) | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on #208's branch, iPhone 17 simulator: **666 passed, 0 failed**, including 12 new `MessageSenderTests`.

## Notes

- Before: an underwriter's reply showed as an unlabelled grey bubble under "Bob Murphy · Your broker", and VoiceOver read it as "Your broker".
- Steps 1 and 3: Uma's two messages in a row show "Bank lending officer" once, above the first. Step 2: Bob's show "Bob Murphy".
- Step 5: the header reads "Your broker · Murphy Mortgages, with the bank's lending officer", the composer "Message Bob and the bank", and the Home card "Talk to Bob Murphy and the bank's lending officer about your application."
- Step 6: the unit tests are in, and the Figma frame [15f Lending officer has written](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=421-1877) shows "Bank lending officer" above the underwriter's bubble, the header "…with the bank's lending officer" and the composer "Message Bob and the bank" (see `wireframe.png`).
