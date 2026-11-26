# Test case: AL-180 and its subtasks

Deploy the al-ai service to AWS

Each row is one acceptance criterion from Jira, word for word, with what I ran and where the evidence is. Evidence files are in `../evidence/`.

| Item | Detail |
|---|---|
| Task | AL-180: Deploy the al-ai service to AWS |
| Subtasks | AL-229 al-ai secrets and task role, AL-230 run al-ai on ECS, AL-231 live check, docs and teardown |
| Related | AL-129 (Bedrock client, PR #219) and AL-223 (shared infrastructure, see `../AL-223/test-case.md`) |
| Epic | AL-15 Project Infrastructure |
| Owner | Nic |
| Sprint | Sprint 3 (16 to 28 Nov 2026) |
| Wireframe / design | No screen of its own. The underwriter sees the committee's result in the portal loan file (Nikoloz's screens). Design: `../AL-15-aws-architecture.png` |
| Code | `al-ai/Dockerfile`, `al-ai/entrypoint.sh`, `al-ai/app/llm/clients.py` (Bedrock), `deploy/foundations/al-ai-secrets.tf`, `deploy/foundations/al-ai-roles.tf`, `deploy/app/ecs.tf` |
| Jira status on 26 Nov | AL-129, AL-180, AL-229, AL-230 and AL-231 all Done |

## Preconditions

- The stack is up. I rebuilt it on 23 Nov at 23:34 UTC with build `06b7f2f` (`07-al-down-up-timed.txt`).
- The seeded users are on the hosted Firebase project: borrowers `alice` and `ben`, underwriter `uma`, broker `ciara`.
- al-ai's two secrets are filled in Secrets Manager.

## AL-180 (parent)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-180-01 | al-ai runs on ECS Fargate (ARM64) behind the shared load balancer at `/ai/*` and `/ai/docs` opens over HTTPS from a browser | See TC-230-01 and TC-230-03 | Health 200, docs page loads | Pass. `08-live-checks-26-nov.txt`: `/ai/health` 200 and `/ai/docs` 200 (the Swagger UI page) |
| TC-180-02 | API keys and the Firebase service account are read from AWS Secrets Manager at runtime and are never in the image or the repo | See TC-229-01 and TC-229-03 | Keys come in when the task starts, none in the image | Pass. See TC-229-01 and TC-229-03 |
| TC-180-03 | A committee run on the deployed service returns a decision, with the affordability agent calling Amazon Bedrock | See TC-231-01 | Decision saved, affordability provider `bedrock` | Pass, 23 Nov. `al231-evidence-committee-log.txt` and `03-committee-three-agents-approve.png` |
| TC-180-04 | docs/infrastructure.md section 6 no longer says Planned | See TC-231-02 | No "Planned" in section 6 | Pass. PR #275 merged on 24 Nov |

## AL-229 al-ai secrets and task role (PR #247)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-229-01 | The Gemini, Mistral, Groq and Serper keys and the Firebase service account are in Secrets Manager and injected when the task starts | 1. Apply foundations 2. Fill the two secrets 3. Deploy 4. Run the committee | Task starts, Gemini and Groq calls work | Pass. Terraform makes two empty secrets: `agentic-lender/al-ai/api-keys` (the four keys as JSON) and the Firebase service account (`deploy/foundations/al-ai-secrets.tf`). The task definition passes them in (#253). The 23 Nov runs called Gemini and Groq (`al231-evidence-committee-log.txt`) |
| TC-229-02 | The task role can only invoke the Qwen3 32B model on Bedrock in eu-west-1, read its own secrets and write logs | IAM policy simulator on the real account | Qwen3 32B allowed, any other model denied | Pass, with one change from the wording. The task role's only permission is `bedrock:InvokeModel` on `qwen.qwen3-32b-v1:0` in eu-west-1 (`deploy/foundations/al-ai-roles.tf`). Reading secrets and writing logs sit on the separate execution role, because ECS does those before our code starts. Simulator results in #247: task role allowed Qwen3 32B, denied another model, denied `GetSecretValue`; execution role allowed `GetSecretValue`, denied Bedrock |
| TC-229-03 | Inspecting the image shows no keys | Check what goes into the image and how it's built | No keys, no `.env` | Pass, checked from the build, not by opening the image. `al-ai/Dockerfile` copies only `pyproject.toml`, `uv.lock`, `app/`, `models/`, `ml/` and `entrypoint.sh`. `.env` and `.env.*` are in `al-ai/.dockerignore`. The image is built only by the Images workflow in GitHub Actions with no build arguments or secrets passed in. Latest build: run 45734016366 on 26 Nov, both images built (`08-live-checks-26-nov.txt`) |

## AL-230 Run al-ai on ECS (PR #253)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-230-01 | An ARM64 Fargate task (0.5 vCPU, 2 GB) runs behind `/ai/*` and passes the `/ai/health` check | `./deploy/al up`, then `curl https://api.agentic-lender.com/ai/health` | 200 | Pass. `07-al-down-up-timed.txt` (23 Nov, `/ai/health 200` after `up`) and `08-live-checks-26-nov.txt` (200, `{"status":"ok"}`). Size and CPU type are in `deploy/app/ecs.tf`: `cpu = 512`, `memory = 2048`, `cpu_architecture = "ARM64"` |
| TC-230-02 | Logs go to CloudWatch with 14-day retention and a request id on every call | 1. Call any endpoint 2. Read the log group `/agentic-lender/al-ai` | One line per request with the `X-Request-ID` value | Pass. `retention_in_days = 14` in `deploy/foundations/al-ai-secrets.tf`. #253 added one log line per request with the request id, covered by 3 new tests. Since #270 the committee also writes one line per run step, which is what `al231-evidence-committee-log.txt` shows |
| TC-230-03 | `/ai/docs` opens over HTTPS from a browser | Open `https://api.agentic-lender.com/ai/docs` | The API docs page | Pass. `08-live-checks-26-nov.txt`: HTTPS 200, `text/html`, page title "al-ai - Swagger UI" |

## AL-231 Live check, docs and teardown (PR #275)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-231-01 | One committee run on the deployed service returns a decision and its log shows the Bedrock call | 1. As `uma`, re-run the committee on an application 2. Read the CloudWatch committee lines | Run complete, affordability step shows `bedrock qwen.qwen3-32b-v1:0` | Pass, 23 Nov. `al231-evidence-committee-log.txt` (19:34 UTC): re-runs of alice's and ben's applications. Affordability `bedrock qwen.qwen3-32b-v1:0` ok in 0.5 s and 1.1 s, valuation `groq openai/gpt-oss-120b`, market and strategist `gemini gemini-3.1-flash-lite`. Both finished complete, in 51.3 s and 42.2 s. `03-committee-three-agents-approve.png`: run `c6a2e191…` (22:56:46 to 22:57:06), all three votes Approve, affordability on bedrock |
| TC-231-02 | `docs/infrastructure.md` section 6 no longer says Planned | Read section 6 on `main` | No "Planned" | Pass. PR #275 merged on 24 Nov. Section 6 on `main` says "Live since 23 November 2026" for the portal and both services, and has no "Planned" left |
| TC-231-03 | Screenshots and log extracts go in the Sprint 3 summary | Add them to "Sprint 3 summary - Nic" in Confluence | They're on the page | Not done yet. The files are ready in `../evidence/` |
| TC-231-04 | `down` runs at the end of the sprint and its output is saved | `./deploy/al down` | Output saved | Not done yet. I ran it once on 23 Nov to time it (33 destroyed in 4 min 12 s, `07-al-down-up-timed.txt`) and brought the stack straight back up. The end-of-sprint `down` is on the last day |

Note: AL-231 shows Done in Jira but TC-231-03 and TC-231-04 aren't met yet.

## End-to-end run on the live stack

Ben's application `fHrxrx9iHFHvb92mEC23` on `https://agentic-lender.com`, 23 Nov:

| File | Shows |
|---|---|
| `ben-fresh-application-run.log` | Ben submits a fresh application at about 22:45:52 UTC. It's still at Applied after 613 s, with no LTV or risk tier |
| `ben-rerun.log` | uma re-runs the committee (run `c6a2e191…`). By the first check, 20 s later, it's AI Deliberated / complete |
| `03-committee-three-agents-approve.png` | That run: started 22:56:46, finished 22:57:06, affordability on bedrock `qwen.qwen3-32b-v1:0`, valuation on groq `openai/gpt-oss-120b`, all three Approve |
| `01-loan-file-model-estimate-and-ltv.png` | The loan file with the model estimate and LTV that #278 now saves |
| `02-valuation-breakdown-shapley.png` | The valuation breakdown in the loan file |
| `04-uma-confirm-approval.png` | uma confirming the approval |
| `05-underwriter-approved-mint-error.png` | Decision saved (Underwriter Approved), but the first mint failed with "Could not reach the server". al-core had crashed because the chain-keys secret held the wallet address and not its private key (`docs/deployment.md` section 9) |
| `06-loan-note-minted.png` | After I fixed the secret, "Loan note minted". It was token 2 on Polygon Amoy, tx `0x8ff90bdec4dffca38bc6867c90009630f46f7822f140c4ae0ed8da0d6ff38a0e` (my AL-231 Jira comment, 23 Nov) |

The fixes the live run found are listed in `../sprint-3-summary.md` under "Fixes without a ticket".
