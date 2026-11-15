# Sprint 2 retrospective: Dumi (database, blockchain and the al-core API)

## What went well

- Mint and close work on a real local chain, not only against fakes. The close endpoint has a script that runs the real API against the emulators and the chain (16 checks), and all 16 pass.
- Reviews caught real things. In the review of the AI run record I saw that renaming the credit memo field would have broken every mint, because the audit record reads it by that name, so we kept the name. The empty-attempts crash in the retry code was found and fixed in #178. Nic found that the refinancing rate went stale in the cache after three months even when it was still the current rate, and that became AL-298.
- When a hash in the audit record had to change (the loan terms, AL-283), we agreed it before any real loan had been hashed, and I sent Nic the new test hashes the same day.
- A live run caught what the tests did not. When Nic ran a real committee run for my AL-34 test case, it showed that the seed had no Eircode, so the run failed validation straight away. I fixed it in AL-306 within two days.

## What did not go well

- AL-140 (logging every AI call) sat for about a week. It changes Nic's code, so I could not build it until my five design questions were answered and his run-id change was merged. I should have asked for the two answers that mattered earlier, and not left all five on the ticket.
- Two al-ai pull requests that were each green merged one after the other and left `main` with four failing tests (AL-300). CI only tests a branch on its own, not combined with what has just merged.
- #177 had to be brought up to date with `main` several times because other pull requests merged first, and each time the approval was dropped and needed another review.
- The Jira automation missed several moves again (6 and 7 November) and I moved tickets by hand.
- I wrote the sprint summary late, in pieces, and had to fix its numbers more than once as pull requests merged.
- The Sprint 1 action to post the retro and submission dates at sprint start was mine and Nic's, and it did not happen. The dates went up ten days into the sprint.

## What I learned

- **Test the combined result, not each branch alone.** #200 and #201 were each green, but together two tests failed, and the same thing broke `main` earlier (AL-300). Merging both into a scratch copy of `main` and running the tests found it in minutes.
- **A live run finds what fakes miss.** The missing Eircode in the seed and the fact that the audit pack hashes its own copy of the credit memo, not the one in `ai_runs`, both only showed when someone ran the real thing.
- **Ask the blocking question early and say which one blocks you.** A ticket with five open questions waits longer than a ticket with the two that matter at the top.

## Actions for Sprint 3

| Action | Owner | How we'll know |
|---|---|---|
| When a pull request merges, the next open one merges `main` in and re-runs its tests before it is approved, so combined breakage shows up before it lands. | Everyone | No PR merges with a test that fails on the latest `main`. |
| Put the one or two questions that block you at the top of the ticket and ask in `#dev` the same day, not only as a comment. | Everyone | Blocking questions are answered within a day or two. |
| Create a ticket on day one of the sprint to post the retro and submission dates in `#announcements` and book the retro. | Nic and me | The dates are posted in the first two days of the sprint. |
| Put the contracts on a public testnet (AL-183) and get the al-core Docker image ready for AWS (AL-212). | Me | Both contracts have testnet addresses, and the image builds and starts. |
