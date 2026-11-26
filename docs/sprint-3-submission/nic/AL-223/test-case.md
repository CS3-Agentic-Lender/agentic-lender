# Test case: AL-223 and its subtasks

Set up the shared AWS infrastructure with Terraform

I tested each acceptance criterion against the merged PRs, the Jira comments and the files in `../evidence/`. The live checks marked "23 Nov 23:43 UTC" are `curl` calls I ran against the live site while the stack was up.

| Item | Detail |
|---|---|
| Task | AL-223: Set up the shared AWS infrastructure with Terraform |
| Subtasks | AL-224 account guardrails, AL-225 Terraform foundations, AL-226 network, load balancer and WAF, AL-227 ECR and the ARM64 image build, AL-326 al-core secrets and roles, AL-228 run al-core on ECS, AL-328 host the portal on Amplify |
| Epic | AL-15 Project Infrastructure |
| Owner | Me (all the AWS and Terraform work). Solomon gave me al-core's Dockerfile (AL-212) and its keys |
| Sprint | Sprint 3 (16 to 28 Nov 2026) |
| Wireframe / design | No screen. The design is `../AL-15-aws-architecture.png` (also `docs/diagrams/09-aws-architecture.png`) |
| Code | `deploy/foundations/`, `deploy/app/`, `deploy/al`, `.github/workflows/images.yml`, `.github/workflows/portal.yml`, on `main` at `06b7f2f` |
| Jira status on 26 Nov | AL-223 In Progress (only criterion 6 left). AL-224, 225, 226, 227, 228, 326, 328 Done |

## Preconditions

- I'm signed in to the team AWS account with `aws sso login` / `aws login` (there are no access keys).
- The stack is up (`./deploy/al status`). I rebuilt it at 23:34 UTC on 23 Nov with build `06b7f2f`.
- Floci (the local AWS emulator on my PC) is running, for the rows marked Floci.

## AL-223 (parent)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-223-01 | Budget alerts exist before any billed resource is created | See TC-224-03 | Budget in place before the first real apply | Pass. Budget created 17 Nov (AL-224 comment); first real-account apply 18 Nov (#224, #247) |
| TC-223-02 | `api.agentic-lender.com` serves HTTPS through one load balancer with a WAF, routing `/ai/*` and `/core/*` | 1. `curl https://api.agentic-lender.com/ai/health` 2. same for `/core/health` 3. `curl https://api.agentic-lender.com/nothing` | 200, 200, 404 from the load balancer default rule | Pass, live 23 Nov 23:43 UTC: 200, 200, 404. WAF rules: TC-226-03 |
| TC-223-03 | GitHub Actions builds ARM64 images for both services on merge to `main` and pushes them to ECR. No laptop pushes, except Nic's Mac as the backup | 1. `gh run list --workflow images.yml` 2. Compare the deployed `image_tag` with a `main` commit | Push runs on `main` succeed; the deployed tag is a `main` commit id | Pass. Push runs on `main` succeeded 23 Nov 22:39, 23:26, 23:29 UTC. `07-al-down-up-timed.txt`: `image_tag = 06b7f2f416bbf3444ccfaf502fdee8dd9d60fa6f`, the merge commit of #278. Since #262 the build signs in with its own push-only role |
| TC-223-04 | al-core runs on ECS Fargate (ARM64) in production. al-ai runs on the same setup under AL-180 | See TC-228-01 and AL-180's TC-230-01 | Both services healthy | Pass. `07-al-down-up-timed.txt`: "al-ai and al-core steady state, /ai/health 200, /core/health 200" |
| TC-223-05 | `up`, `deploy`, `status` and `down` work and a full `down` then `up` is timed | 1. `./deploy/al down` (answer both prompts) 2. `./deploy/al up` 3. Time both | Both complete, services healthy after `up` | Pass, 23 Nov. `down`: 33 destroyed in 4 min 12 s. `up`: 33 added in 3 min 22 s. Total about 7.5 min. `../evidence/07-al-down-up-timed.txt`; AL-223 and AL-231 Jira comments; `docs/deployment.md` section 6 (on `main` since PR #275 merged on 24 Nov) |
| TC-223-06 | Torn down at the end of Sprint 3 and brought back up for demo week | 1. `./deploy/al down` at the end of the sprint 2. `./deploy/al up` in demo week | Nothing billed by the hour between the two | Not yet. I ran the timed `up` straight after the 23 Nov `down`, so the stack is still live. The `down` happens at the end of the sprint (28 Nov) and the `up` in demo week |

## AL-224 Account guardrails

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-224-01 | Nic signs in to the team AWS account as an IAM user with MFA | Sign in to the console | IAM user with MFA, no access keys | Pass, 17 Nov. IAM user `Nicholas` (group `Admin`) with MFA, no access keys; root has MFA and no keys (AL-224 comment) |
| TC-224-02 | Credits and payment method checked and recorded in the sprint summary | Billing console, Credits | Credits and payment method shown | Pass, 17 Nov: USD 100.00 remaining, expires 17 May 2027; payment method checked (AL-224 comment). Two screenshots are attached to AL-224 in Jira, not yet in `../evidence/` |
| TC-224-03 | Budget alerts on actual charges at about EUR 20 and EUR 50 exist before any billed resource, with a screenshot | Billing, Budgets | Alerts at about 20 and 50 on actual spend | Pass, 17 Nov. Budget `agentic-lender-monthly`, USD 50 a month, emails at USD 20 and USD 50 actual and USD 50 forecast; credits excluded (AL-224 comment). Note: set in USD, not EUR. Screenshot on AL-224 in Jira |

## AL-225 Terraform state, deploy role, DNS, certificate and wrapper commands (PR #224)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-225-01 | State in an encrypted, versioned and locked S3 bucket | 1. Apply foundations 2. Inspect the bucket 3. Start a second run while one holds the lock | Versioning and AES256 on, public access blocked; second run refused | Pass on Floci (#224): versioning, AES256, public access block and "Error acquiring the state lock". The real account has used this state since 18 Nov |
| TC-225-02 | A GitHub deploy role trusts only this repo's `main` branch | Read the trust policy | `sub` condition is `repo:<repo>:ref:refs/heads/main` only | Pass on reading: `deploy/foundations/github-deploy-role.tf` lines 39-40. Runs from `main` work, but I didn't record a test of a run from another branch being refused |
| TC-225-03 | The DNS zone is in the team AWS account and the domain's name servers point at it | Resolve `api.agentic-lender.com` | Resolves to the load balancer | Pass. Live 23 Nov 23:43 UTC (TC-223-02); `docs/deployment.md` section 1 |
| TC-225-04 | A validated certificate covers `api.agentic-lender.com` | `curl https://api.agentic-lender.com/ai/health` | TLS handshake succeeds, 200 | Pass. Live 23 Nov 23:43 UTC; certificate ISSUED on Floci (#224) |
| TC-225-05 | `up`, `deploy <tag>`, `status` and `down` say what they'll change and ask before acting; `down` asks twice | Run each | A plain-words plan, then a prompt; two prompts for `down` | Pass (#224 on Floci; the 23 Nov `down` timing includes both prompts). #265 later added the old and new values to the plan shown |

## AL-226 Network, load balancer and WAF (PR #234)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-226-01 | Public subnets in two availability zones | Read `deploy/app/network.tf`; apply | Two subnets in two AZs | Pass: `10.0.1.0/24` and `10.0.2.0/24`; applied on Floci and live |
| TC-226-02 | HTTPS only; HTTP redirects to HTTPS | `curl http://api.agentic-lender.com/ai/health` | 301 to `https://` | Pass, live 23 Nov 23:43 UTC: 301 to `https://api.agentic-lender.com:443/ai/health`. Listener 443 uses `ELBSecurityPolicy-TLS13-1-2-2021-06` (#234) |
| TC-226-03 | WAF rate limit of about 300 requests per 5 minutes per IP on the load balancer | Inspect the web ACL | Rule `per-ip-limit` 300/300 s, associated with the load balancer | Pass on Floci (#234: three rules, 20/60 s on `POST /core/me`, 300/300 s, AWS common rules). Checked against the live account on 23 Nov (#275). I didn't run a load test. #263 turned off request sampling so tokens aren't stored |
| TC-226-04 | The task security group accepts traffic only from the load balancer | Read `security-groups.tf` | Ingress only from the load balancer's group | Pass on reading: rule `tasks_from_alb` (#234) |
| TC-226-05 | CloudWatch alarms for unhealthy tasks, load balancer 5xx and the budget | Apply; check alarms with no tasks running | Health alarms go to ALARM with no tasks | Pass on Floci (#234: both health alarms went to ALARM before tasks existed). Budget covered by AL-224's budget. #259 stopped a missing tfvars file from deleting the alarm emails |

## AL-227 ECR and the ARM64 image build (PR #236)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-227-01 | ECR repositories for al-ai and al-core, with scan on push | Inspect the repositories | Both exist, scan on push, immutable tags | Pass (#236 on Floci; live in the 23 Nov check, #275). Retention changed to 90 days in #261 |
| TC-227-02 | On a PR, both images build for ARM64 without pushing | Open a PR touching `al-ai/` or `al-core/` | Images workflow builds, pushes nothing | Pass. `gh run list --workflow images.yml`: pull_request runs succeeded on 23 Nov (for example `fix/committee-saves-valuation-detail`) |
| TC-227-03 | On merge to `main`, both ARM64 images are built and pushed, tagged with the commit id | Merge, then check the tag | Tag = full commit id | Pass. Deployed tag `06b7f2f416bbf3444ccfaf502fdee8dd9d60fa6f` (`../evidence/07-al-down-up-timed.txt`) |
| TC-227-04 | A manual build and push from Nic's Mac is documented as the backup | Read `deploy/README.md` "Backup" | Steps present | Pass on reading (#236) |

## AL-326 al-core secrets and roles (PR #251)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-326-01 | Three secrets exist, created empty by Terraform, hold their values, none in state, repo, Slack or Jira | 1. Apply 2. Fill by hand 3. Check each has a current version | All three have a value; Terraform never wrote one | Pass. Created empty (#251); all three have a current value (#257). The chain-keys secret first held the wallet address instead of the key; fixed on 23 Nov (`docs/deployment.md` section 9). Values went through Bitwarden Sends |
| TC-326-02 | Execution role pulls only the al-core image, reads only its secrets, writes only its log group; task role has no permissions | IAM policy simulator | Allowed and denied as listed | Pass. Simulator table on the real account in #251 |
| TC-326-03 | The boundary lets al-core's execution role read only its own secrets and al-ai's only al-ai's | IAM policy simulator | Cross-reads denied | Pass. #251: al-core execution reading al-ai's keys denied; al-ai execution reading al-core's keys denied |
| TC-326-04 | The policy simulator shows each role's allowed and denied actions | IAM policy simulator | Table recorded | Pass. 13-row table in #251 |

## AL-228 Run al-core on ECS (PRs #257, #274)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-228-01 | AL-212's image runs as an ARM64 Fargate service (0.25 vCPU, 0.5 GB) behind `/core/*` and passes its health check | `./deploy/al up`, then `curl .../core/health` | 200 | Pass. `07-al-down-up-timed.txt` and live 23 Nov 23:43 UTC: 200. Sizes from the planned task definition in #257 |
| TC-228-02 | Secrets from AL-326 injected at start; non-secret settings as plain environment variables | Read the task definition; mint a loan note | Six secrets from the three al-core secrets; chain settings as env | Pass. #257 (`terraform show -json`), #274 (Amoy settings). A loan note was minted from AWS on 23 Nov, token 2, tx `0x8ff90bdec4dffca38bc6867c90009630f46f7822f140c4ae0ed8da0d6ff38a0e` (AL-231 comment; `../evidence/06-loan-note-minted.png`) |
| TC-228-03 | A full `down` then `up` is timed and recorded in `docs/deployment.md` | See TC-223-05 | Times in section 6 | Pass: 4 min 12 s and 3 min 22 s are in `docs/deployment.md` section 6, on `main` since PR #275 merged on 24 Nov |

## AL-328 Host the portal on Amplify at agentic-lender.com (PRs #267, #272)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-328-01 | Terraform in `deploy/foundations` makes an Amplify app serving the `al-web` production build from `main`; it survives `down`; Floci skips it | 1. Foundations plan 2. `down` 3. `curl https://agentic-lender.com` | App planned; site still up after `down`; Floci plan has no portal | Pass. #267 plan "5 to add"; Floci plan without portal resources; the 23 Nov `down` kept the Amplify portal (AL-223 comment); live 200 at 23:43 UTC |
| TC-328-02 | Every non-file path is rewritten to `/index.html` with 200 | `curl https://agentic-lender.com/underwriter/applications/test` | 200 with the app shell | Pass. Floci 19 Nov (AL-328 comment); live 23 Nov 23:43 UTC: 200, body has `<div id="root">` |
| TC-328-03 | `agentic-lender.com` through our Route 53 zone with an Amplify certificate; `www` redirects to it | `curl -I https://www.agentic-lender.com` | 301 to `https://agentic-lender.com/` | Pass. Live 23 Nov 23:43 UTC: 301, `location: https://agentic-lender.com/`. Amplify domain `AVAILABLE` (#275) |
| TC-328-04 | `portal.yml` builds on PRs touching `al-web/` without uploading; on merge to `main` (or by hand) builds and uploads with a role that can only deploy this app; only public `VITE_*` values | `gh run list --workflow portal.yml` | PR runs succeed; a `main` run uploads | Pass. PR runs succeeded 23 Nov (AL-333 branch); manual run on `main` 23 Nov 18:35 UTC succeeded. #272 fixed the role's missing `amplify:CreateDeployment` |
| TC-328-05 | HSTS, a CSP allowing only our API and Firebase, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy` | `curl -I https://agentic-lender.com` | All five headers | Pass. Live 23 Nov 23:43 UTC: `strict-transport-security: max-age=31536000; includeSubDomains`, `content-security-policy` with `frame-ancestors 'none'`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin` |
| TC-328-06 | Rehearsed first on Floci's Amplify at `app.agentic-lender.test` | Floci console | Site loads, deep-link refresh works, sign-in page renders | Pass, 19 Nov (AL-328 comment) |
| TC-328-07 | `agentic-lender.com` is an authorised Firebase Auth domain; the seeded broker and underwriter sign in; API calls pass CORS; no requests to localhost | Sign in on the live URL as each user; watch the browser's network panel | Sign-in works, no CORS errors, no localhost requests | Mostly pass. Sign-in as both seeded users checked on 23 Nov (#275). The underwriter's approve and mint calls worked from the live portal (`../evidence/04`, `06`), so CORS passed. I didn't record a network-panel check for localhost. The built JS only has `http://localhost` inside Firebase SDK fallback code, which doesn't prove anything either way. The authorised-domain step is written down in `deploy/README.md` (line 192 on `main`) |
| TC-328-08 | Deploy steps in `deploy/README.md`; `docs/infrastructure.md` says the portal is on Amplify | Read both | Both present | Pass. `docs/infrastructure.md` says the portal is on Amplify and, since PR #275 merged on 24 Nov, "Live since 23 November 2026" |

## Notes

1. Most of the Terraform evidence comes from Floci plus read-only plans against the real account, as written up in the PR bodies. The live checks above cover what a user can actually reach.
2. AL-224's screenshots are attachments on the Jira ticket, not in `../evidence/`.
3. Everything here is in the team account 176550299403 (already public in `docs/deployment.md`).
