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
