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
