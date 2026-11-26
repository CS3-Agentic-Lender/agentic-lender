# Sprint 3 summary - Nic

Sprint 3 ran 16 to 28 Nov 2026. Status as of 26 Nov.

## What I did

This sprint I put the app on AWS. It's been live since 23 Nov, with the portal at https://agentic-lender.com and the API at https://api.agentic-lender.com. It's all Terraform and anyone on the team can run it with `./deploy/al up`, `deploy`, `status` and `down`. al-ai and al-core each run as a container on Fargate behind one load balancer, the portal is hosted on Amplify and the affordability agent uses Qwen3 32B on Bedrock instead of Ollama. Taking it down takes about 4 minutes and bringing it back up about 3.

Running a real application through the live site found faults the tests hadn't, like a slow ECB reply timing out the committee and the model estimate never being saved, which stopped the mint. I fixed each one in its own small PR, and on 23 Nov the first loan note was minted from AWS (token 2 on Polygon Amoy). At the end of the sprint I built the admin portal Seamus asked for (AL-337). An admin can manage broker and underwriter accounts, handle the app's reviews and support requests and see a read-only view of the business. I also added live committee progress on the loan file (AL-344) and made the portal load without freezing (AL-343).

## Tickets finished

AL-129, AL-224, AL-225, AL-226, AL-227, AL-228, AL-229, AL-230, AL-231, AL-180, AL-326, AL-327, AL-328, AL-337, AL-343 and AL-344. The PRs are linked on each ticket in Jira.

## Fixes without a ticket

14 small `fix/` PRs, from a security check of the infrastructure on 23 Nov (#259 to #265) and from the first live runs (#269, #270, #272, #276, #277, #278, #283). #220 also went in without a ticket, on a `feature/` branch.

## Evidence

The screenshots show Ben's application going through the live site, from the loan file and the committee vote to the approval and the minted loan note. The test cases for AL-180, AL-223 and AL-337 in the Sprint 3 submission have every acceptance criterion with its result.

## Not finished

- **AL-223:** the `./deploy/al down` at the end of the sprint, then `up` again for demo week.
- **AL-204:** the Sprint 3 zip, due 29 Nov.
- **AL-337:** three of its checks still need a manual run before the zip.

One thing I got wrong: #284 put the al-core rules change in my PR instead of its own PR to Dumi, so rules changes go to him separately from now on.

## Why I chose what I chose

- **Fargate on ARM64:** no servers to look after, our Macs build the same ARM images that get deployed and it's about 20% cheaper than x86.
- **Bedrock on AWS:** a public site can't call Ollama on a team laptop, so the deployed app uses Qwen3 32B on Bedrock in the same Qwen family. Ollama is still used locally, as the brief asks.
- **Budget kill switch:** AWS budgets only send emails, so at USD 50 of spend a budget action locks the deploy role. `down` is still the real off switch.
