# Sprint 3 summary - Nic

Sprint 3 ran 16 to 28 Nov 2026. Status as of 26 Nov.

## Tickets finished

| Ticket | What | PR | Merged |
|---|---|---|---|
| [AL-129](https://alprojectcs3.atlassian.net/browse/AL-129) | Amazon Bedrock variant for the deployed affordability agent | [#219](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/219) | 17 Nov |
| [AL-224](https://alprojectcs3.atlassian.net/browse/AL-224) | Account guardrails in the team AWS account | none (console work, evidence in the Jira comments) | Done 17 Nov |
| [AL-225](https://alprojectcs3.atlassian.net/browse/AL-225) | Terraform state, deploy role, DNS, certificate and the `al` commands | [#224](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/224) | 18 Nov |
| [AL-226](https://alprojectcs3.atlassian.net/browse/AL-226) | Network, load balancer, WAF and alarms | [#234](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/234) | 18 Nov |
| [AL-227](https://alprojectcs3.atlassian.net/browse/AL-227) | ECR repositories and the ARM64 image build | [#236](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/236) | 18 Nov |
| [AL-229](https://alprojectcs3.atlassian.net/browse/AL-229) | al-ai's secrets, log group and ECS roles | [#247](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/247) | 18 Nov |
| [AL-326](https://alprojectcs3.atlassian.net/browse/AL-326) | al-core's secrets, log group and ECS roles | [#251](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/251) | 18 Nov |
| [AL-230](https://alprojectcs3.atlassian.net/browse/AL-230) | Run al-ai on Fargate behind `/ai` | [#253](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/253) | 20 Nov |
| [AL-327](https://alprojectcs3.atlassian.net/browse/AL-327) | Bug: a committee run interrupted mid-way stays "running" for ever | [#254](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/254) | 20 Nov |
| [AL-228](https://alprojectcs3.atlassian.net/browse/AL-228) | Run al-core on Fargate behind `/core`, then its Polygon Amoy settings | [#257](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/257), [#274](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/274) | 23 Nov |
| [AL-328](https://alprojectcs3.atlassian.net/browse/AL-328) | Host the portal on Amplify at agentic-lender.com | [#267](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/267) | 23 Nov |
| [AL-231](https://alprojectcs3.atlassian.net/browse/AL-231) | Live check of the deployment and the docs marked Live | [#275](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/275) | 24 Nov |
| [AL-180](https://alprojectcs3.atlassian.net/browse/AL-180) | Deploy the al-ai service to AWS (parent of AL-229, AL-230, AL-231) | see its subtasks | Done 24 Nov |
| [AL-337](https://alprojectcs3.atlassian.net/browse/AL-337) | Story: as an admin, I manage staff accounts and handle the app's reviews and support requests (subtasks AL-338 to AL-342) | [#284](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/284) | 25 Nov |
| [AL-343](https://alprojectcs3.atlassian.net/browse/AL-343) | Portal loads without freezing and shows placeholder panels while loading | [#284](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/284) | 25 Nov |
| [AL-344](https://alprojectcs3.atlassian.net/browse/AL-344) | Story: as an underwriter, I watch the AI committee work live on the loan file (subtasks AL-345, AL-346) | [#284](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/284) | 25 Nov |

AL-62 (saving each agent's reasoning trail) shows on the Sprint 3 board too but I finished it on 12 Nov, in Sprint 2.

## Fixes without a ticket

| PR | What it fixed |
|---|---|
| [#220](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/220) | `/ai/affordability` could go past the iPhone's 15 s limit when the rates cache expired. ECB timeout 20 s down to 6 s, one 2 s try on the Firestore cache. (This one went on a `feature/` branch, not `fix/`.) |
| [#259](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/259) | A foundations plan without the gitignored tfvars file would have deleted every alarm email subscription |
| [#260](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/260) | The USD 50 budget had no action. It now attaches deny-all to the GitHub deploy role at 100% of actual spend |
| [#261](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/261) | The keep-30-images rule could delete the deployed build before the demo. Images now expire 90 days after push |
| [#262](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/262) | The image build ran as the admin deploy role. It has its own push-only role now |
| [#263](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/263) | WAF sampled requests were storing live Firebase bearer tokens. Sampling's off |
| [#264](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/264) | al-ai ran as root on a writable filesystem with tag-only base images. Now non-root, read-only, pinned digests |
| [#265](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/265) | `./deploy/al` only listed resource names before asking. It shows old and new values now |
| [#269](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/269) | The first live committee run failed on a cold ECB reply (16 s against a 6 s limit). Background calls wait up to 30 s and the cache is warmed at start |
| [#270](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/270) | Committee runs left nothing in CloudWatch. One JSON line per run step now |
| [#272](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/272) | The portal role was refused `amplify:CreateDeployment` on its first upload |
| [#276](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/276) | A live run gave up after three Gemini 503s in 77 s. 429 and 503 back off 10, 30 then 60 s |
| [#277](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/277) | A failed run left its application stuck at Applied. Added `POST /ai/committee/runs` (underwriter only) |
| [#278](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/278) | The committee never saved `valuationDetail` or `dtiBreakdown`, so the loan file had no estimate and the mint was refused |
| [#283](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/283) | Ibrahima spotted that an old run could overwrite a re-run's review, because the "do I still hold this application" check and the write were two separate calls. They're one Firestore transaction now (merged 24 Nov) |

Docs-only, also no ticket: [#230](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/230) (let small bug fixes skip the ticket) and [#252](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/252) (delete the al-ai key files only after both uploads work).

## What was actually built

This sprint I took the app off our laptops and onto AWS. It's been live since 23 Nov, the portal at `https://agentic-lender.com` and the API at `https://api.agentic-lender.com`. At the end of the sprint I also built the admin portal Seamus asked for.

**The infrastructure (AL-223).** It's all Terraform, in two folders. `deploy/foundations` is what stays up between demos: the state bucket, the DNS zone and certificate, the two ECR registries, the secrets, the IAM roles and the Amplify portal. `deploy/app` is what's billed by the hour: a VPC with public subnets in two zones, the load balancer with its WAF, the alarms and the two Fargate services. The load balancer sends `/ai/*` to al-ai and `/core/*` to al-core and redirects HTTP to HTTPS. Only the load balancer can reach the tasks. The WAF allows 300 requests per 5 minutes per IP, the same as the nginx gateway we use locally. I wrapped it in `./deploy/al` (`up`, `deploy <tag>`, `status`, `down`) so nobody has to type Terraform. It explains the plan in plain words and asks first and `down` asks twice. I practised the Terraform changes on Floci, a local AWS emulator, before running them on the real account. The budget action is the one part Floci can't run.

**The images.** Only GitHub Actions builds the images that get deployed. Each merge to `main` builds both ARM64 images and pushes them tagged with the commit id. A PR builds them without pushing, so a Dockerfile that won't build on ARM fails before merge.

**Keys.** al-ai has two secrets and al-core three, all created empty by Terraform so no key ever reaches the state file. I filled them by hand. A permissions boundary (a limit on what a role can ever be given) means each service's role can read only its own secrets and the GitHub deploy role can't read any of them. I checked this in the IAM policy simulator on the real account.

**al-ai on AWS (AL-180).** One task, 0.5 vCPU and 2 GB. On AWS the affordability agent runs on Qwen3 32B through Bedrock (AL-129) and the task role can call that one model and nothing else. Groq and Gemini are unchanged. Locally it still runs on Ollama.

**al-core on AWS (AL-228).** I didn't write al-core's code or its Dockerfile (that's Dumi's, AL-212). My part was running it: one 0.25 vCPU / 0.5 GB task, its Stripe and wallet keys from Secrets Manager and the Polygon Amoy contract settings once Dumi had deployed the contracts.

**The portal (AL-328).** Amplify (AWS's website hosting) serves the production build of al-web at the root domain, with `www` redirecting to it and security headers on every response. A GitHub workflow builds and uploads it on each merge.

**The live run.** Getting a real application through end to end found faults the tests hadn't. One of the first committee runs timed out because the ECB took 16 s to answer, against a 6 s limit. Another gave up after Gemini said it was too busy (HTTP 503) three times. A failed run had no way to re-run and the committee had never saved the model estimate or the DTI breakdown, which the mint needs. Dumi found that last one when the first mint from AWS was refused with 409 "no rate yet". I fixed each one in its own `fix/` PR (table above). On the mint al-core also crashed, because the chain-keys secret held the wallet address instead of its private key. Once the private key was in the secret and al-core restarted, the retry minted loan note token 2 on Amoy.

**The admin portal (AL-337).** Seamus wanted an admin who can set up broker and underwriter accounts, so it isn't read-only. I agreed the scope with Dumi and Nikoloz first since it touches both their directories. An admin can create, disable, re-enable, change the role of and delete staff accounts. It all goes through al-core with the Firebase admin SDK and every action is logged to `admin_actions`. It won't delete someone who still has borrowers or applications or who has signed off applications and it only changes broker and underwriter accounts, so an admin can't lock themselves out. Admins are only ever made by a script, never from the portal. The admin also reads the reviews and support requests borrowers send from the iOS app, adds notes to support requests and closes them. There's a read-only business view too, with applications, users, AI runs and the audit trail.

**Live committee progress and smoother loading (AL-344, AL-343).** Neither ticket is on the Sprint 3 board in Jira, but both were made on 24 Nov and finished on 25 Nov in #284. The committee now writes each step's progress and each agent's result while the run is going, so the underwriter watches the agent tabs go queued, thinking and then done. Opening a loan file used to freeze the page for 1932 ms while the 3D view loaded. Now the longest freeze is 94 ms and the first download is 113 kB smaller.

## Evidence it works

| Evidence | What it shows |
|---|---|
| `01-loan-file-model-estimate-and-ltv.png` | Ben's loan file on the live portal: model estimate €383,000, purchase LTV 85.7%, indicative LTV 70.5%, risk tier B |
| `02-valuation-breakdown-shapley.png` | How each detail moved the estimate, from the saved `valuationDetail` |
| `03-committee-three-agents-approve.png` | Run `c6a2e191…`, 22:56:46 to 22:57:06. Affordability on `bedrock` / `qwen.qwen3-32b-v1:0`, valuation on `groq`, strategist on Gemini, all Approve |
| `04-uma-confirm-approval.png` | The underwriter (uma) confirming the approval |
| `05-underwriter-approved-mint-error.png` | The first mint attempt on Ben's application failing with "Could not reach the server". The real error was in al-core: the chain-keys secret held the wallet address instead of its private key (`docs/deployment.md` section 9). Dumi's earlier 409 "no rate yet" was a different attempt, on Alice's application at 19:44, before #278 |
| `06-loan-note-minted.png` | The retry: loan note minted, token 2 on Polygon Amoy |
| `al231-evidence-committee-log.txt` | The CloudWatch committee lines: affordability `bedrock qwen.qwen3-32b-v1:0` ok in 0.5 s and 1.1 s, both runs finished complete in 51.3 s and 42.2 s |
| `ben-fresh-application-run.log`, `ben-rerun.log` | Ben's fresh application sitting at Applied after 613 s, then uma's re-run reaching AI Deliberated in about 20 s |
| `07-al-down-up-timed.txt` | `down`: 33 destroyed in 4 min 12 s. `up`: 33 added in 3 min 22 s, then `/ai/health` and `/core/health` both 200 |
| [AL-223 test case](../AL-223/test-case.md), [AL-180 test case](../AL-180/test-case.md) | Every acceptance criterion with its result |
| [#284](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/284) | Admin portal and live progress: portal 1021 tests passed, al-core 981, Firestore rules 593, al-ai 1347. Each admin action checked by hand in Chrome on the emulators |

Mint transaction: `0x8ff90bdec4dffca38bc6867c90009630f46f7822f140c4ae0ed8da0d6ff38a0e`. After the timed rebuild on 23 Nov both services answered health 200 at 23:34 UTC (`07-al-down-up-timed.txt`). I checked again on 26 Nov: both health checks 200, the portal 200 and `www.agentic-lender.com` redirects (301) to the root domain.

## What did not get finished and why

| Ticket | What's left | Why |
|---|---|---|
| [AL-223](https://alprojectcs3.atlassian.net/browse/AL-223) | Criterion 6: take it down at the end of Sprint 3 and bring it back up for demo week | The stack's live for the last days of the sprint, so the `down` happens on the last day |
| [AL-204](https://alprojectcs3.atlassian.net/browse/AL-204) | The Sprint 3 zip | Everyone's wireframes, test cases and retro input are due Sat 28 Nov, then I export the board and the code and upload by 23:59 Sun 29 Nov |
| [AL-337](https://alprojectcs3.atlassian.net/browse/AL-337) | Its wireframe, test case and the AL-336 Administration use case for the zip | Added to the sprint on 24 Nov, so the write-up comes after the code |

One thing I got wrong: #284 went in under AL-337 with the al-core rules change inside it, when we'd agreed AL-338 and AL-339 would be their own PRs to Dumi. He reviewed the core side after the merge and it was fine, but rules changes go on their own PR to him from now on.

## Anything a marker would ask

**Why Fargate and why ARM64?** ECS Express Mode (AWS's simplified container setup) doesn't let us set the load balancer rules we need to put both services on one web address. AWS isn't taking new App Runner customers. EC2 would mean looking after servers and Lambda would have to reload the ML model whenever it starts up from cold, which is slow. ARM64 because our Macs are ARM, so they build and run the same image that gets deployed with no emulation. Fargate on ARM64 also costs about 20% less and GitHub has free ARM runners for public repos. Going back to x86 is one setting in the task definitions and the workflow.

**Why Bedrock and not Ollama on AWS?** The brief asks for a local model through Ollama. Pointing a public site at Ollama on a team laptop would be a security risk, so the deployed app calls Qwen3 32B on Bedrock in its place. That was decided in September and agreed with the supervisor. Qwen3 32B was picked at the team meeting on 8 Oct because it's the same Qwen family as `qwen3.5:9b`, so local runs and the live site behave alike. It runs In-Region in eu-west-1, so borrower data sent to it stays in Ireland. Locally we still use Ollama and a local run shows Ollama working at the demo.

**Why the budget kill switch?** AWS budgets only send alerts. They don't stop spending. My own account's credits expired on 14 Sep and I cover any charges the team account's credits don't. So when actual spend reaches 100% of the USD 50 budget, an AWS Budgets action attaches a deny-all policy to the GitHub deploy role and the deploy role can't detach it. It isn't a hard cap: tasks already running keep billing and billing data comes in hours late. `./deploy/al down` is still the real off switch. I found the action was missing on 23 Nov (`guardrails.tf` assumed one existed) and added it in #260.

**Why the portal on the root domain?** It started at `app.agentic-lender.com`. On 23 Nov I moved it to `agentic-lender.com`, with `www` redirecting to it. I announced it in #announcements and tagged Nikoloz since it's his portal.

**Why a fresh application for the mint and not a backfill?** #278 only saves the estimate and DTI breakdown on runs that happen after it, so applications whose runs had already finished still had neither. Their estimate is in the old run's `ai_calls` record, so a backfill was possible. So instead I submitted a fresh application as Ben once #278 was merged and took it through the committee, uma's approval and the mint. My reason, as I told Dumi at the time: they're only test applications, so patching an old run doesn't prove anything, while a fresh one runs through the fixed code end to end and needs no admin key. Ben's first run sat at Applied and the re-run endpoint from #277 got it through.

**Why so many `fix/` PRs with no ticket?** We agreed as a team that small bug fixes in your own subsystem can skip the ticket ([#230](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/230) and the rule in `AGENTS.md`). Each one still has its own branch, its own PR, tests and a teammate's review. Most came from a security pass over the infrastructure on 23 Nov and from the first live runs. They're listed above so they count, since they don't show on the board. #220 is the odd one out, it went on a `feature/` branch by mistake. #277 adds an endpoint but it's the re-run endpoint we'd already agreed in `docs/api-design.md` back in October, so it didn't change a contract. #278 just made the committee save two fields that `SCHEMA.md` already said it saves.
