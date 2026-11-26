# Sprint 3 retrospective: Nic (AI, valuation and the AWS deployment)

## Check on my Sprint 2 actions

1. **Update each test case when its PR merges:** not really. I wrote my Sprint 3 test cases up on 23 Nov, near the end of the sprint, same as last time.
2. **Decide the AL-27 three-month rate limit with the team:** didn't happen. I never made a ticket for it, so the code and the criterion still disagree.
3. **Open connection PRs earlier:** no. #278 (saving the model estimate and DTI breakdown) merged on 23 Nov and the admin portal (#284) on 25 Nov.
4. **Get the emulator tests running in CI:** not done. Only the al-core workflow starts the Firestore emulator. The al-ai one doesn't, so the `test_auto_start` tests still don't run in CI.

## What went well

- The app has been live on AWS since 23 Nov. The portal is at `https://agentic-lender.com` and the API at `https://api.agentic-lender.com`. It's all Terraform and anyone on the team can run it with `./deploy/al up`, `deploy`, `status` and `down` without knowing Terraform.
- I practised the Terraform on Floci (an AWS emulator that runs locally) before running it on the real account. Floci couldn't do the Amplify portal or the budget action, so those two only ran on the real account.
- Taking it down and bringing it back up is quick. On 23 Nov `down` took 4 min 12 s and `up` took 3 min 22 s, and both health checks answered 200 after.
- On 23 Nov I went through the infrastructure for security and cost problems and fixed seven in their own small PRs (#259 to #265):
  - the WAF was storing live Firebase tokens in its samples
  - the budget had no action, so it could only send emails
  - the image build ran as the admin deploy role
  - al-ai ran as root
  - old images could be deleted before the demo
  - a missing settings file could wipe the alarm emails
  - `./deploy/al` didn't show the old and new values before asking.
- The first loan note was minted from AWS on 23 Nov (token 2 on Polygon Amoy). The affordability agent ran on Bedrock and the other agents on Groq and Gemini.
- I merged 30 PRs between 16 and 26 Nov and reviewed 41 of the team's PRs that merged in that time.
- Seamus asked for an admin page. I agreed what it would do with Dumi and Nikoloz before building it and it went in as AL-337.

## What did not go well

- The first live runs found five faults the tests hadn't:
  - the committee timed out waiting on a slow first reply from the ECB
  - it gave up when Gemini answered "busy" three times
  - a failed run had no way to re-run
  - the committee never saved the model estimate or the DTI breakdown
  - the chain-keys secret held the wallet address instead of its private key.
  
  The missing DTI breakdown only showed up when Dumi's first mint from AWS was refused.
- #284 went in under AL-337 with the al-core rules change inside it. We'd agreed AL-338 and AL-339 would be their own PRs to Dumi, so he only got to review the core side after it merged. He said the code was fine but it's his directory and he should have seen it first.
- #284 also carried the smoother loading (AL-343) and the live committee progress (AL-344), so one PR covered three tickets.
- My work bunched up at the end again. 19 of my 30 PRs merged between 23 and 26 Nov, which left the others little time to build on them.
- #220 went on a `feature/` branch when it should have been a `fix/` one.

## What I learned

- Tests passing isn't the same as it working live. A real application taken from submit to mint on the deployed app is a test of its own, and it should happen straight after the first deploy, not at the end.
- AWS budgets only send emails. To actually stop anything you have to attach an action yourself, so `./deploy/al down` is still the real off switch.
- If a change touches someone else's directory it gets its own PR to them, even when they've already agreed to the work.

## Actions for the rest of the project (final code 20 Dec, demo 4 Jan)

| Action | Owner | How we'll know |
|---|---|---|
| Run `./deploy/al down` at the end of the sprint and `up` again for demo week. | Me | AL-223 criterion 6 is met. |
| Any change to `firestore.rules` or other al-core files goes on its own ticket and PR to Dumi. | Me | Dumi reviews every al-core change before it merges. |
| Take the AL-27 three-month rate limit to the team: fix the code or reword the criterion. | Me | A ticket exists and the code and the criterion agree before 20 Dec. |
| Do a full live run (submit, committee, approval, mint) after every deploy, not just the health checks. | Me | Each deploy has a run id and a mint result written down. |
| Get al-ai's CI to start the Firestore emulator so `test_auto_start` runs there. | Me, with Dumi | The al-ai CI run includes the `test_auto_start` tests. |
