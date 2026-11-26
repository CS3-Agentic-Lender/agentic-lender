# Use case: AL-15 Project Infrastructure (Sprint 3: the AWS deployment)

AL-15 is where the non-feature work lives. In Sprint 3 the big piece of it is the deployment: the API and the portal run on AWS, so the demo doesn't need anyone's laptop. This use case covers the deployment as it runs on `main` at the end of Sprint 3. No earlier sprint had a use case for AL-15.

| Item | Detail |
|---|---|
| Epic | AL-15 Project Infrastructure |
| Feature (from the brief) | Week 3: "outline and setup of the infrastructure used to ... develop, test and deploy". The brief doesn't ask for a cloud deployment, we chose to do one (Should have) |
| Owner | Me (all the AWS and Terraform work). Solomon did al-core's image (AL-212), the hosted Firebase project (AL-181) and the testnet contracts (AL-183). Nikoloz did the portal's production build (AL-182). Ibrahima did the iOS demo build against the live backend (AL-184) |
| Sprint | Sprint 3 (16 to 28 Nov 2026). Live since 23 Nov 2026 |
| Design | `AL-15-aws-architecture.png` in this folder (also `docs/diagrams/09-aws-architecture.png`) |

## Goal

As a developer on the team, I want the whole app running on AWS from one command, so the live demo runs without a team laptop and I can tear it down when we don't need it.

## Actors

- **Deployer** (me): signs in with `aws login` and runs `./deploy/al up | deploy <tag> | status | down`.
- **GitHub Actions**: builds the ARM64 images on every merge to `main` and uploads the portal. Each workflow signs in with its own role that only trusts this repo's `main` branch.
- **Users**: brokers and underwriters on the portal at `agentic-lender.com` and borrowers on the iOS demo build. Both call `api.agentic-lender.com`.
- **AWS**: Route 53 (DNS), the load balancer with its WAF (a firewall that also rate limits), ECS Fargate (runs our containers without us looking after servers) for al-ai and al-core, ECR (where the images are stored), Secrets Manager, CloudWatch (logs and alarms), Bedrock (hosted AI models), Amplify Hosting (hosts the portal) and Budgets.
- **Outside AWS**: Firebase (Firestore and Auth), Gemini, Groq, Serper, the ECB and Polygon Amoy.

## Preconditions

- The one-time foundations exist (`deploy/foundations`): the state bucket, the DNS zone, the certificate, the ECR repositories, the secrets (filled in by hand), the roles, the Amplify app and the budget with its alerts.
- There's an image pair in ECR for the commit I want to deploy (the Images workflow pushes one on every merge to `main`).
- I'm signed in to the team AWS account.

## Trigger

I run `./deploy/al up` (bring everything back) or `./deploy/al deploy <commit id>` (release a new build).

## Main flow

1. `al` runs a Terraform plan of `deploy/app` and prints it in plain words, with the old and new values.
2. I confirm. Terraform applies exactly that plan.
3. Terraform creates or updates the network, the load balancer and its WAF, the ECS cluster and the two services, each on the image tag I gave.
4. ECS starts the tasks and hands each service its keys from Secrets Manager when it starts. The load balancer waits for `/ai/health` and `/core/health` to pass before it sends any traffic.
5. `al status` shows both services healthy. `https://api.agentic-lender.com/ai/*` reaches al-ai and `/core/*` reaches al-core. Any other path gets a 404.
6. Users work on the live site. al-ai runs the committee with the affordability agent on Bedrock (Qwen3 32B) and al-core mints loan notes on Polygon Amoy.
7. When we don't need the stack, I run `./deploy/al down`. It asks twice, then removes everything that's billed by the hour. The foundations and the portal stay.

## Alternative flows

- **Release a build:** merge to `main`, wait for the Images workflow, then run `./deploy/al deploy <full commit id>`. If the new tasks fail their health checks ECS rolls back on its own.
- **Portal release:** a merge that touches `al-web/` (or a manual run) builds the site and uploads it to Amplify. It doesn't depend on `up` or `down`.
- **CI broken:** my Mac builds both ARM64 images and pushes them (`deploy/README.md`, "Backup").
- **Rehearsal:** the same Terraform applies to Floci (a local AWS emulator) first. Amplify is skipped there.

## Exceptions

- If I don't confirm the plan nothing changes.
- A missing image tag or a key name missing from a secret stops the task from starting. On a later deploy ECS keeps the old task running.
- Spend reaches the USD 50 budget: an AWS Budgets action attaches a deny-all policy to the GitHub deploy role. It doesn't stop what's already running, so someone still has to run `down`.
- More than about 300 requests in 5 minutes from one IP: the WAF answers 429.
- A task fails its health check: the "no healthy task" alarm emails the team.

## Postconditions

After `up` or `deploy`, both services are healthy behind `api.agentic-lender.com` on the chosen build. After `down` nothing's billed by the hour, the foundations and the portal are still there and `up` brings it all back in about 3.5 minutes.

## Business rules

- Only GitHub Actions builds the images that get deployed, always ARM64 and tagged with the commit id. Laptops build their own images for local use only.
- A person starts every deploy. Merging never deploys anything.
- No key is in the Terraform state, the repo, an image, Slack or Jira. Secrets are created empty and I fill them in by hand.
- Each role only gets what it needs (al-ai's task role can call one Bedrock model and nothing else). A permissions boundary stops roles reading each other's secrets.
- Bedrock replaces Ollama only on the deployed app. Local runs still use Ollama.
- The hourly resources get torn down after the Sprint 3 test run and after the demo.

## Measured

| What | Result | Source |
|---|---|---|
| `./deploy/al down` | 33 resources destroyed in 4 min 12 s, 23 Nov | `evidence/07-al-down-up-timed.txt` |
| `./deploy/al up` | 33 resources added in 3 min 22 s, both services healthy (200) | same |
| Live committee run with Bedrock | affordability on `qwen.qwen3-32b-v1:0` in 0.5 to 1.1 s, whole run 42 to 51 s | `evidence/al231-evidence-committee-log.txt` |
| Loan note minted from AWS | token 2 on Polygon Amoy | AL-231 comment, `evidence/06-loan-note-minted.png` |

## Tickets in this epic (Sprint 3 deployment work)

| Ticket | What | Owner | Status on 26 Nov |
|---|---|---|---|
| AL-223 | Shared AWS infrastructure with Terraform (subtasks AL-224, 225, 226, 227, 228, 326, 328) | Me | In Progress (criterion 6 left) |
| AL-180 | Deploy al-ai to AWS (subtasks AL-229, 230, 231) | Me | Done |
| AL-181 | Hosted Firebase project | Solomon | Done |
| AL-182 | Portal production build ready for Amplify | Nikoloz | Done |
| AL-183 | Contracts on a public testnet | Solomon | Done |
| AL-184 | iOS demo build against the live backend | Ibrahima | Done |
| AL-174 | Sprint 3 retrospective | Nikoloz | To Do |
| AL-204 | Sprint 3 submission | Me | In Progress |

## Still to do

PR #275 merged on 24 Nov, so the docs now say Live. What's left is tearing the stack down at the end of Sprint 3 and bringing it back up for demo week (AL-223 criterion 6).
