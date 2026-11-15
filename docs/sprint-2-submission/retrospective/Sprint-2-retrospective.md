# Sprint 2 retrospective: Nic (AI valuation and the committee)

## What went well

- The AI committee now runs end to end on its own. A submitted application starts the committee (#176), the three voting agents and the policy gate run, and one run record is saved with the memo, the votes and the consensus (#197, #200, #201). AL-130 is Done.
- I merged 30 PRs between 27 October and 12 November: the valuation endpoint and its breakdown, the valuation, market and strategist agents, the policy gate, HELOC support, the LangGraph flow, retries and a time budget, and the fields the app and portal read.
- Because code works out the price gap, both LTVs, the risk tier and the policy limits, the agents can only explain them. Tests cover each check, and the agent's reply is checked before it is used.
- I reviewed 51 merged PRs from the team across the sprint.
- When Mistral turned out to have no free API on 27 October, I proposed Groq for the valuation agent in `#announcements`, Ibrahima agreed, and the change is recorded in `docs/infrastructure.md`.

## What did not go well

- The last connection PRs landed late. #197, #200, #201 and #202 merged on 12 November, one day before the 13 November deadline, so Ibrahima and Nikoloz had little time to build on them.
- My test cases went stale. When I re-checked them on 13 November, three still said "not met yet" for work that had since merged (the call log in AL-27, the memo and gate saving in AL-28, and the AL-130 run record). I rewrote them against `main`.
- The re-check also found a gap I had not caught. AL-27 says rates older than 3 months are refused, but the check only applies when the ECB is down. A fake ECB reply with a May rate came back as 3.9 with no error. This contradicts the Jira comment that said the criterion was met, and it is not fixed yet.
- Some acceptance criteria still describe an older plan. AL-26 and AL-29 name Mistral, and the code runs Groq and Gemini, so those rows read "not met as worded".
- The 62 `test_auto_start` tests need the Firestore emulator, so my normal local run skipped them. They passed only when I started the emulator on purpose.

## What I learned

- A test result is only true for the commit it ran on. I now write the commit and the date next to each result.
- A Jira comment that says "met" is not evidence. I checked each criterion against the code and the test.
- Free tiers can disappear. I should confirm that a key works before a plan depends on it.

## Actions for Sprint 3

| Action | Owner | How we'll know |
|---|---|---|
| Re-run a story's tests and update its test case when its PR merges, not at the end of the sprint. | Me | Each test case names a commit no older than its last merged PR. |
| Decide with the team whether to fix the 3-month rate limit in AL-27 or reword the criterion. | Me | A ticket exists and the criterion and the code agree. |
| Open connection PRs earlier in the week so the other subsystems have time to build on them. | Me | No committee PR merges in the last two days of the sprint. |
| Ask Dumi whether the emulator tests can run in CI, so none of them are skipped. | Me | `test_auto_start` shows no skips in CI. |

<div style="page-break-before: always"></div>

# Sprint 2 retrospective: Ibrahima (iOS borrower app)

## What went well

- **Sprint 2 delivery was strong and consistent.** Most of my work was merged early, with 22 PRs merged between 27 October and 3 November and all 8 stories reaching Done, which kept delivery on track and reduced the risk of work carrying over.
- **Test coverage and automation improved.** The unit test count reached 654 on `main`, and I added a UI test target (#153) that runs end-to-end on the emulators, giving more confidence than unit tests alone.
- **I helped stabilise mobile CI.** I fixed the CI crash and hang issues (AL-259, AL-276), so the team could validate changes without losing time to infrastructure failures.
- **I caught a genuine issue through testing.** My AL-31 test case exposed a failure in the four-line explanation on 6 November. It was fixed under AL-303, and step 2 was successfully re-run on `main`.
- **My code reviews helped prevent integration problems.** In #200 and #201 I spotted two tests that would conflict once both changes were merged, and a missing broker guard. Nic addressed them, and Dumi confirmed the fixes with a combined test run.
- **Key product flows now work end to end against the real backend:** messaging, live status, the HELOC application and the valuation breakdown.

## What did not go well

- **A near miss with test reporting on 30 October.** After an Xcode update, the test run failed but still printed "Passed 537" because it was reading the previous night's results. It was caught, but it risked false confidence in a failing build. Since then, each test run saves its results to its own file.
- **AL-136 was implemented against outdated acceptance criteria.** It used "typical listing" rather than AL-132's wording, reworded on 27 October. The subtask description had not been updated and I didn't check the parent story, so it shipped wording that no longer matched the story.
- **The work came in a large burst.** With 22 PRs landing in the first week, reviewers had a lot to process at once, and most of the work after 6 November was fixes rather than new delivery.
- **An integration clash between #136 and #131.** The older branch merged after the newer one, and one of their tests disagreed ("Ref APP-7F3K"), which took extra investigation.
- **Small process mistakes slipped through.** A session trailer got into a commit on #132, and a stray ticket key was left in a test comment on AL-144. Minor, but my final commit checks could be more thorough.
- **Jira automation was unreliable.** Missed transitions meant AL-303 and AL-31 had to be moved by hand, so Jira was a less accurate picture of progress.
- **On-screen checks for test-case evidence stayed manual.** The UI test target runs on its own, but the simulator could not be driven by the available tools, so each on-screen check for a test case needed me to tap through by hand.

None of these stopped the sprint goals being met, but they caused avoidable rework, review pressure and manual effort.

## What I learned

- **Test results need to be independently verifiable.** A passing count means very little if it comes from a previous run, so each run needs its own results.
- **The parent story holds the latest requirements.** Subtask descriptions can go out of date; the parent story and its acceptance criteria are the source of truth.
- **Test cases expose gaps before work is considered complete.** The AL-31 test case led to AL-303. Testing should check the acceptance criteria, not just that the implementation appears to work.
- **Reviews need to consider the bigger picture.** #200 and #201, and #136 and #131, showed that how changes interact on `main` matters as much as whether each PR works on its own.

## Actions for Sprint 3

| Action | Owner | How we'll know |
|---|---|---|
| Spread PR delivery evenly: open a PR as each subtask is completed, a few smaller PRs through the week rather than a large batch. | Me | PRs are opened throughout the sprint, not concentrated in the first week. |
| Verify requirements before implementation: read the parent story and its latest acceptance criteria before starting a subtask, and confirm it in the PR description. | Me | Every PR confirms the parent story's criteria were checked. |
| Improve merge safety: before approving an older branch, merge the latest `main` into it and re-run the relevant tests. | Everyone | Older branches are tested against the latest `main` before merging. |
| Complete AL-310: show who sent each message in the iOS thread, so borrowers can tell the lending officer from the broker. | Me | Sender attribution works in the iOS thread and is covered by tests. |

<div style="page-break-before: always"></div>

# Sprint 2 retrospective: Nikoloz (web portal)

## What went well

- Most of the underwriter journey in the portal is now on main. In Sprint 2 I got these merged: the loan file with the DTI breakdown (#117), the valuation chart (#140) and its support warnings (#187), the HELOC queue filter and collateral panel (#141, #190), sign-off (#189), minting (#191), the audit pack download (#192), the committee console (#195), the mortgage collateral panel (#188) and the broker inbox (#193). The AL-248 client list fixes carried over from Sprint 1 also went in early (#116, #122).
- I tested against the real backend and not only against fakes. On 10 Nov I ran al-core from main with the emulators and a local Hardhat node. A sign-off saved the decision with the underwriter's id, the time and the reason. The seeded HELOC minted as token 2. Its audit pack CSV came back with every hash matching the chain (`verified true`).
- Nic's reviews caught real bugs and I fixed each one with a test. The API client read FastAPI's `detail` field, but al-core sends `{"error": {"message"}}`, so every real error would have shown a generic message. A CSV cell starting with `=` could run as a formula in Excel. The collateral panel told a broker "not stored" when the review just couldn't be read.
- I reviewed 18 of my teammates' PRs, across all three of the other subsystems. On #138 I reproduced a bug where the personal-data check refused normal text like "the D24 area" as an Eircode, which would have stopped a real committee run.
- Before merging the last nine PRs, I merged them all into a throwaway copy of main. That showed which order gave the fewest conflicts, and the result passed 699 tests before anything was merged for real.

## What did not go well

- I built six features as a chain of stacked branches on 6 Nov, even though we had agreed in the Sprint 1 retro not to stack PRs. They then sat until 10 Nov, 31 commits behind main. Every retarget and every merge of main dropped the approvals, so Nic had to approve some PRs three times, and the chain took 12 and 13 Nov to merge.
- Dumi's #169 changed how the valuation breakdown is stored on 6 Nov, and my chart on main showed "not available" for every application until #187 merged on 12 Nov.
- On 10 Nov the broker inbox hung on "Loading..." against the emulator. I tried a code change that didn't fix it, and I couldn't work out why. On a clean start on 13 Nov it loads in about 3 seconds every time, so it was probably my long-running local setup, but I never found the actual cause.
- Some loan file tests fail now and then when several test suites run at the same time (AL-273), which made results harder to trust.
- The Jira automation didn't move tickets on merge, and the parent stories sat in To Do until 10 Nov because nothing moves them.
- I left my submission folder late (12 Nov), and 17 of the 39 steps in my test cases are still unticked because I haven't run them yet.

## What I learned

- In this repo any push or retarget dismisses approvals. A stack of PRs therefore costs one extra review per PR, so it's better to open one PR per ticket from main as soon as the work is ready.
- Read the backend's actual error and data shapes before writing the client. The error format bug came from assuming FastAPI's default.
- "Couldn't read it" and "it isn't there" are different states, and the screen has to say which one it is.
- Small file-level things matter for the submission too. Git treated our PDFs as text, so a Windows checkout broke 22 of them (#204 fixes it).

## Actions for Sprint 3

1. One ticket, one branch from main, one PR. No stacks.
2. When main moves, merge it in and rerun the tests before asking for a review, not after.
3. Write the test case and do the live check while building each ticket, not at the end of the sprint.
4. Move the parent story in Jira whenever a subtask moves.
5. Get #194 merged early. Start the Firebase Hosting deploy (AL-182) once the hosted project exists. Ask Dumi about the shape of the stress-test endpoints before building the rate-shock and downturn views (AL-162, AL-163).

<div style="page-break-before: always"></div>

# Sprint 2 retrospective: Dumi (database and blockchain)

## Check on the Sprint 1 actions

1. **No stacking:** this worked. All 102 PRs since 27 October went into `main`. The second half, no re-approvals, did not hold: whenever `main` moved, approvals were dropped (mine on #177 several times).
2. **Jira to Done the same day:** partly. The automation came back on 3 November but still missed moves, and I moved at least four by hand. Also, 9 Stories in Sprint 2 are still In Review or In Progress although their subtasks merged (AL-23, AL-30, AL-37, AL-38, AL-43, AL-133, AL-151, AL-152, AL-196). The burndown only drops when a whole Story reaches Done, so we should close them or say why they stay open.
3. **Post the retro and submission dates at sprint start:** this was mine and Nic's, and it did not happen. The submission dates went up on 6 November, about ten days in, and the retro was booked on 14 November. I should have posted it on day one.

## What went well

- Mint and close work on a real local chain, with a script that runs 16 checks against the real API, the emulators and the chain.
- The audit hash change (AL-283) was agreed before any real loan had been hashed.
- Reviews caught real bugs again.

## What did not go well

- AL-140 sat for about a week: I left five questions on the ticket and did not push for the two that mattered.
- `main` went red when two green al-ai PRs merged one after the other (AL-300).
- I wrote my sprint summary late, in pieces.

## Actions for Sprint 3

| Action | Owner |
|---|---|
| When a PR merges, the next open one merges `main` in and re-runs its tests before approval. | Everyone |
| Put the one or two blocking questions at the top of the ticket and ask in `#dev` the same day. | Everyone |
| A ticket on day one of the sprint to post the dates in `#announcements` and book the retro. | Nic and Dumi |

First in Sprint 3: the contracts on a public testnet (AL-183) and the al-core Docker image for AWS (AL-212).
