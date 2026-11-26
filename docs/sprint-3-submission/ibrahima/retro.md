# Sprint 3 retrospective: Ibrahima (iOS borrower app)

## Check on my Sprint 2 actions

| Action | What happened |
|---|---|
| Spread PR delivery evenly through the sprint. | Not met. 19 of my 20 Sprint 3 PRs were opened and merged between 16 and 18 November. |
| Read the parent story's latest criteria before starting a subtask. | Met. Each Sprint 3 story was built against its own criteria, and each test case checks them row by row. |
| Before approving an older branch, merge the latest `main` into it and re-run the tests. | Met. I tested #283 with `main` merged in (1443 passing) before approving it. |
| Complete AL-310: show who sent each message. | Done (#208, 16 Nov). |

## What went well

- **The whole demo journey ran on the live backend.** On 23 November the demo build on the simulator went all the way through against the hosted Firebase project, the API on AWS and Polygon Amoy: Google sign-in, profile, broker choice, submit, the fast-track fee, the AI committee, the underwriter's decision and the loan note minted as token #3. The status screen followed every step live. That closed AL-184.
- **Stripe worked on AWS, not only locally.** The fast-track fee (AL-44) was paid in Stripe's sandbox on the hosted build, and the app showed the receipt only after al-core's webhook on AWS had marked the fee paid, as the criteria ask. The app holds only the publishable test key.
- **My reviews caught real bugs before they shipped.** On #278 I spotted that an old AI run could overwrite a re-run's results, which Nic fixed in #283 with a Firestore transaction. On #280 I found that a closed application's timeline was wrong, and the fix went in with a test over every status.
- **All six of my Sprint 3 stories are Done:** AL-44, 45, 46, 310, 311 and 313, each with a test case. The unit tests are at 786 passing on `main`, and the 8 end-to-end UI tests pass on the local stack.

## What did not go well

- **Some bugs were found late, at test or review time instead of while building.** The Messages badge doesn't appear for a brand-new borrower's first message (AL-335): I only found it in the AL-313 simulator run on 24 November. The 500-character review limit counts emoji differently in the app and al-core (AL-317), which came up in review.
- **A story was added mid-sprint.** AL-313 (the tab bar) was added on 16 November because 54 Figma frames showed a tab bar that no ticket covered. It was the right call, but it changed the sprint after it started.
- **The demo run hit a Gemini timeout.** The first committee run on the hosted build failed at the strategist step, and the demo journey had to wait for Nic to re-run it.
- **I waited on other subsystems before I could test end to end.** The support form (AL-45) and reviews (AL-46) waited on Dumi's endpoints, and the demo build (AL-184) was blocked until the hosted project and the API on AWS were up.

## What I learned

- **Running the real app finds what the unit tests miss.** The badge bug passed every unit test and only showed on the simulator with a brand-new borrower.
- **The designs and the backlog need to match.** If a frame shows something, a ticket should cover it before the sprint starts.
- **The hosted stack behaves differently from the local one.** Timeouts and slow cloud calls only showed up on the live backend, late in the sprint.

## Actions for the next sprint

| Action | Owner | How we'll know |
|---|---|---|
| Check the Figma frames against the tickets at sprint planning, so every screen in the designs has a ticket. | Me | No story is added mid-sprint because of something already in Figma. |
| Run the hosted build early in the sprint, not only in the last week. | Me | The first hosted run is in the sprint's first week. |
| Ask Nic for a retry or a longer timeout on the committee's cloud LLM calls. | Me, with Nic | A slow Gemini reply no longer fails a run. |
| Agree the endpoint shapes with the backend owner before starting the iOS side of a story. | Me, with Dumi | No iOS story waits on an endpoint whose shape is still undecided. |
