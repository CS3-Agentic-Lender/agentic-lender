# Sprint 3 Retrospective: Nikoloz (Web Portal)

**Evidence last updated:** 28 November 2026  
**Main commit:** `006edb0`

## What went well

Overall, I think Sprint 3 went well in terms of the amount of work completed on the web portal. A lot of functionality was added, and we also improved some of the existing features based on feedback during code reviews.

- Fixed the audit pack download functionality in PR #231 so that the file URL is properly revoked after the download is triggered.
- Fixed subscription timing issues affecting the loan file and client file tests in PR #232.
- Updated the underwriter queue so that fast-track applications are displayed first in PR #233.
- Implemented the rate shock page with affordability results in PR #266 and later redesigned it with 3D visualisations in PR #286. The backend functionality was already implemented in PR #250.
- Added production API URL validation and updated the AWS Amplify build documentation in PR #268.
- Completed the 3D loan file in PR #280. This included the voting agent pillars, Market & Macro observer, policy gate and a chain view using stored hashes. Keyboard accessibility and text alternatives were also included. This PR had 792 passing tests recorded and was approved by Ibrahima and Nic.
- Completed the underwriter and broker overview pages in PR #285. Both dashboards were checked using emulator data to make sure the displayed figures matched the sample applications.
- Improved the loan file layout and affordability figures in PR #287. Empty valuation sections now collapse, and repayment, DTI, stressed DTI, surplus and policy breaches are displayed using the stored figures rather than recalculated values.
- Fixed the production rate shock API issue in PR #288. The fix was merged on 27 November and verified on the live website, with requests now going to the API gateway instead of localhost.
- Completed the house price fall page for AL-163 in PR #289, which was merged on 28 November. This included a 3D portfolio view, a 2D exposure chart, before and after LTV figures and accessibility improvements. The recorded full test suite passed all 1,169 tests.
- Enabled underwriters to re-run failed committee runs in PR #290, which was merged on 28 November. The implementation included loading states, error handling and protection against duplicate requests.
- Completed the before and after affordability bands chart for AL-40 in PR #292. This was merged on 28 November, with 1,103 passing tests recorded and an accessibility table for screen-reader users.
- The HELOC review and its subtask were marked as Done on 26 November. All five acceptance criteria were reported as met on main, although the final browser sign-off still needs to be tested.

Code reviews were also useful throughout this sprint. A number of issues were identified that could have been missed during development, including incorrect timeline behaviour, stale affordability figures after failed re-runs, listener readiness and loading state issues. These were addressed in the relevant PRs.

By the end of the sprint, all the Jira stories covered in my review were marked as Done. The remaining PRs were also merged, which was a good improvement compared to where we were on 26 November.

## What did not go well

Although we completed a good amount of work, there were still some issues during the sprint that could have been handled better.

- AL-191 was deleted from Jira, which resulted in PR #279 being closed and replaced by AL-333 and PR #280. This created unnecessary confusion when tracking the completed work.
- The live rate shock page was attempting to connect to localhost because the `VITE_AI_BASE_URL` environment variable was missing from `portal.yml`. Although this was eventually fixed and verified live through PR #288, it was something that could have been identified earlier through production testing.
- The house price fall page and committee re-run functionality were only merged on 28 November. This left less time for final acceptance testing and collecting submission evidence.
- Some admin and broker-client tests timed out when running the entire test suite on the laptop, even though they passed when run individually. This made it difficult to get consistent local test results.
- Some PRs required additional changes after the initial review. For example, PR #286 reached 1,054 passing tests after the review fixes were completed. PRs #285 and #287 also required further changes.
- The HELOC browser sign-off could not be completed because the seeded HELOC application was already approved.
- Although AL-30 was marked as Done in Jira and PR #290 was merged, the live retest of acceptance criteria 1 to 4 still needs to be completed.
- Some submission evidence was completed quite late in the sprint. This reduced the amount of time available to review everything before the submission deadline.

Most of these issues were resolved before the end of the sprint, but I think better planning and earlier testing would have reduced some of the pressure towards the deadline.

## What I learned

One of the biggest things I took away from this sprint is that just because something works locally does not necessarily mean it will work in production. The rate shock issue was a good example of this. The feature was implemented, but a missing environment variable caused problems on the live website. Going forward, I think we need to spend more time checking the actual deployed application rather than relying entirely on local tests.

I also learned that there is a difference between a test passing individually and the entire test suite passing. Some tests timed out when running everything together, so it is important to be clear about which tests were actually completed successfully rather than just reporting that everything passed.

The code reviews also showed me the importance of considering different scenarios when implementing a feature. It is not enough to only test what happens when everything works correctly. We also need to consider failed requests, loading states, outdated data and how the application behaves when something goes wrong.

Another area we still need to improve is following up on unfinished work from previous sprints. AL-30 is an example of this, as some of its original Sprint 2 test steps still need to be completed. Having a merged PR does not always mean that every acceptance criterion has been fully tested.

## Actions for the next sprint

There are a few things I would like us to improve going into the next sprint.

- **Production testing:** The person responsible for implementing a feature should also check that it works on the deployed website, including checking API requests and environment variables.
- **Testing consistency:** Record full-suite and individual test results separately. Investigate tests that regularly time out instead of treating an individual pass as proof that the full suite passes.
- **Acceptance criteria:** Make sure all acceptance criteria are tested before considering a story fully completed.
- **Submission evidence:** Collect screenshots, test results and other evidence throughout the sprint rather than leaving everything until the end.
- **Jira management:** Avoid deleting existing tickets when possible. If a ticket needs to be replaced, clearly link the original ticket to the replacement so that the work remains easy to track.
- **Code reviews:** Carry out more thorough checks before requesting a review to reduce the number of avoidable fixes afterwards.

These are improvements I would suggest discussing with the team before agreeing on the final actions for the next sprint.

## Sprint Review: Finished and Unfinished Stories

### Completed development work

| Story / Subtask | Description | Pull Request | Jira Status |
|---|---|---|---|
| AL-333 | 3D loan file | #280 | Done |
| AL-347 | Underwriter and broker overview pages | #285 | Done |
| AL-348 | Rate shock page redesign | #286 | Done |
| AL-349 | Loan file and affordability improvements | #287 | Done |
| AL-196 | HELOC application review | HELOC implementation | Done |
| AL-213 | HELOC web integration | HELOC implementation | Done |
| AL-40 | Rate shock and affordability bands | #266, #286, #292 | Done |
| AL-41 | House price downturn simulation | #256, #289 (AL-163) | Done |
| AL-163 | House price downturn web page | #289 | Done |
| AL-30 | Committee functionality and re-run | #290 (re-run implementation) | Done |

PR #288 was a separate production API fix supporting the rate shock functionality.

AL-191 and PR #279 are not counted separately because they were replaced by AL-333 and PR #280. AL-163 and AL-213 are listed for implementation coverage and should not be counted as additional completed stories.

All the Jira statuses listed above were confirmed on 28 November 2026.

### Outstanding acceptance testing

Although the development work has been merged and the relevant Jira stories are marked as Done, there are still some manual testing checks outstanding.

| Story | Remaining testing |
|---|---|
| AL-30 | Complete the live retest of acceptance criteria 1 to 4. |
| AL-196 / AL-213 | Complete the HELOC browser sign-off using an application that has not already been approved. |

These are outstanding testing and evidence requirements rather than unfinished development work. There are no unmerged implementation PRs among the stories covered in this review.

## Burndown Chart

The Sprint 3 burndown chart is to be included in the shared group retrospective using the final Jira sprint report.

From my own work, a noticeable amount of development was completed towards the end of the sprint, with PRs #289, #290 and #292 all being merged on 28 November. This shows why we should aim to complete reviews and acceptance testing earlier, rather than having several features finalised close to the submission deadline.

The actual sprint burndown figures and velocity need to be taken directly from Jira.

## Overall Reflection

I think Sprint 3 was productive, particularly in terms of the improvements made to the web portal. We added a good amount of functionality and improved the overall usability of the application. The feedback received during code reviews also helped improve the quality of the features we delivered.

However, I think we could have managed testing, deployment checks and submission evidence better. Some issues were only identified towards the end of the sprint, which created additional work that could potentially have been avoided.

For the next sprint, I would like us to focus not only on completing features but also on making sure they are properly tested, documented and working in production before we consider them finished.
