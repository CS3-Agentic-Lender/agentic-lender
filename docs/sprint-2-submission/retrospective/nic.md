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
