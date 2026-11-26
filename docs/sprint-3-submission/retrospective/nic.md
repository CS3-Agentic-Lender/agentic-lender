# Sprint 3 retrospective: Nic (AI, valuation and the AWS deployment)

## Check on my Sprint 2 actions

1. **Re-run the tests and update the test case when the PR merges:** partly. I re-ran things as I went but I still wrote most of my test cases up on 23 Nov, at the end, same as last time.
2. **Decide the AL-27 three-month rate limit with the team:** didn't happen. There's no ticket for it yet and the code and the criterion still disagree.
3. **Open connection PRs earlier:** no. #278 (saving the model estimate and DTI breakdown) merged on 23 Nov and the admin portal (#284) on 25 Nov.
4. **Get the emulator tests running in CI:** not done. Only the al-core workflow starts the emulator, so al-ai's `test_auto_start` tests still skip in CI.

## What went well

- The app is live on AWS since 23 Nov. The portal is at `https://agentic-lender.com` and the API at `https://api.agentic-lender.com`. It's all Terraform and anyone on the team can run it with `./deploy/al up`, `deploy`, `status` and `down` without knowing Terraform.
- I rehearsed every part on Floci (a local AWS emulator) before it touched the real account, so nothing on the real account went wrong in a way that cost money.
- Taking it down and bringing it back up is quick and I timed it: `down` took 4 min 12 s and `up` took 3 min 22 s, with both health checks back to 200 after.
- A security pass on 23 Nov found six real problems before the demo and I fixed each in its own small PR (#259 to #265). The worst were the WAF storing live Firebase tokens, the budget having no action at all and the image build running as the admin role.
- The first loan note was minted from AWS on 23 Nov, token 2 on Polygon Amoy, with the affordability agent running on Bedrock and the valuation and strategist agents on Groq and Gemini.
- I merged 30 PRs between 16 and 26 Nov and reviewed 41 of the team's merged PRs.
- Seamus asked for an admin page and it went in as AL-337 after I agreed the scope with Dumi and Nikoloz first.

## What did not go well

- The first live run found five faults the tests hadn't: the committee timed out on a cold ECB reply, it gave up on Gemini 503s, a failed run had no way to re-run, the committee had never saved the model estimate or the DTI breakdown and I'd put the wallet address in the chain-keys secret instead of its private key. The estimate one had been missing since Sprint 2 and only showed up when Dumi's first mint from AWS was refused.
- #284 went in under AL-337 with the al-core rules change inside it, so Dumi only got to review the core side after it merged. We'd agreed AL-338 and AL-339 would be their own PRs to him. The code was fine but that's not the point, it's his directory.
- #284 also carried the smoother loading (AL-343) and the live committee progress (AL-344), so one PR closed work from three tickets.
- A lot of my work landed in the last four days of the sprint again, which left the others little time to build on it.
- #220 went on a `feature/` branch when it should have been a `fix/` one.

## What I learned

- Tests passing isn't the same as it working live. A real application run through the deployed app, from submit to mint, is a test of its own and it should happen straight after the first deploy, not at the end.
- AWS budgets only send emails, they don't stop anything. You have to attach an action yourself and even then billing data comes in hours late, so `down` is the real off switch.
- If a change touches someone else's directory it gets its own PR to them, even when they've already agreed to the work.

## Actions for the rest of the project (final code 20 Dec, demo 4 Jan)

| Action | Owner | How we'll know |
|---|---|---|
| Run `./deploy/al down` at the end of the sprint and `up` again for demo week. | Me | AL-223 criterion 6 is met and the bill stays inside the credits. |
| Any change to `firestore.rules` or other al-core files goes on its own ticket and PR to Dumi. | Me | Every al-core change after this has Dumi's review before merge. |
| Take the AL-27 three-month rate limit to the team: fix the code or reword the criterion. | Me | A ticket exists and the code and the criterion agree before 20 Dec. |
| Do a full live run (submit, committee, approval, mint) after every deploy, not just the health checks. | Me | Each deploy note has a run id and a mint result. |
| Get al-ai's CI to start the Firestore emulator so `test_auto_start` stops skipping. | Me, with Dumi | The al-ai CI run shows no skipped `test_auto_start` tests. |
