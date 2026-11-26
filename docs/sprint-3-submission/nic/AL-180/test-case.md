# Test case: AL-180 and its subtasks

Deploy the al-ai service to AWS

I wrote these from the Jira acceptance criteria, the merged PRs and the files in `../evidence/`. The live checks marked "23 Nov 23:43 UTC" were `curl` calls against the live site while the stack was up.

| Item | Detail |
|---|---|
| Task | AL-180: Deploy the al-ai service to AWS |
| Subtasks | AL-229 al-ai secrets and task role, AL-230 run al-ai on ECS, AL-231 live check, docs and teardown |
| Related | AL-129 (Bedrock client, Done, PR #219) and AL-223 (shared infrastructure, see `../AL-223/test-case.md`) |
| Epic | AL-15 Project Infrastructure |
| Owner | Nic |
| Sprint | Sprint 3 (16 to 28 Nov 2026) |
| Wireframe / design | No screen of its own. The underwriter sees the committee's result in the portal loan file (Nikoloz's screens). Design: `../AL-15-aws-architecture.png` |
| Code | `al-ai/entrypoint.sh`, `al-ai/app/llm/agents.aws.json`, `al-ai/app/llm/clients.py` (Bedrock), `deploy/foundations/` (secrets, roles, log group), `deploy/app/ecs.tf`, on `main` at `06b7f2f` |
| Jira status on 26 Nov | AL-180, AL-229, AL-230 and AL-231 Done. PR #275 merged 24 Nov |

## Preconditions

- The stack is up (I rebuilt it on 23 Nov at 23:34 UTC with build `06b7f2f`).
- The seeded users are on the hosted Firebase project: borrower `ben`, underwriter `uma`, broker `ciara` (and `alice`).
- al-ai's secrets are filled in Secrets Manager.

## AL-180 (parent)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-180-01 | al-ai runs on ECS Fargate (ARM64) behind the shared load balancer at `/ai/*` and `/ai/docs` opens over HTTPS from a browser | See TC-230-01 and TC-230-03 | Health 200, docs page loads | Pass. Live on 23 Nov at 23:43 UTC: `/ai/health` 200, `/ai/docs` 200 |
| TC-180-02 | API keys and the Firebase service account are read from Secrets Manager at runtime, never kept in the image or the repo | See TC-229-01 and TC-229-03 | Keys come in when the task starts, none in the image | Pass (#247, #253) |
| TC-180-03 | A committee run on the deployed service returns a decision, with the affordability agent calling Amazon Bedrock | See TC-231-01 | Decision saved, affordability provider is `bedrock` | Pass, 23 Nov (`../evidence/al231-evidence-committee-log.txt`, `03-committee-three-agents-approve.png`) |
| TC-180-04 | `docs/infrastructure.md` section 6 no longer says Planned | See TC-231-02 | No "Planned" for al-ai | Pass. PR #275 merged on 24 Nov. Section 6 on `main` now says "Live since 23 November 2026" |

## AL-229 al-ai secrets and task role (PR #247)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-229-01 | The Gemini, Mistral, Groq and Serper keys and the Firebase service account are in Secrets Manager and get passed in when the task starts | 1. Apply foundations 2. Fill the two secrets 3. Deploy 4. Run the committee | Task starts, Gemini and Groq calls work | Pass. Terraform creates the two secrets empty (#247) and the task definition passes them in (#253). The 23 Nov runs called Gemini and Groq fine (`../evidence/al231-evidence-committee-log.txt`) |
| TC-229-02 | The task role can only call Qwen3 32B on Bedrock in eu-west-1, read its own secrets and write logs | IAM policy simulator on the real account | Qwen3 32B allowed, any other model denied | Pass with a design change. In the #247 simulator check the task role was allowed Qwen3 32B, denied another model and denied `GetSecretValue`. Reading the secrets and writing logs are on the separate execution role, because ECS does those when the task starts. So the task role only holds the Bedrock permission |
| TC-229-03 | Looking inside the image shows no keys | Inspect the built image | No keys, no `.env` | Pass as stated in #247 ("The al-ai image holds no keys or `.env` files"). `.env` is in `.dockerignore`. I didn't save the command I used. To show it again: `docker run --rm --entrypoint sh <image> -c 'env; ls -la /app'` |

## AL-230 Run al-ai on ECS (PR #253)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-230-01 | An ARM64 Fargate task (0.5 vCPU, 2 GB) runs behind `/ai/*` and passes `/ai/health` | `./deploy/al up`, then `curl https://api.agentic-lender.com/ai/health` | 200 | Pass. `../evidence/07-al-down-up-timed.txt` ("/ai/health 200") and live on 23 Nov at 23:43 UTC: 200. The sizes are in `deploy/app/ecs.tf` (#253) |
| TC-230-02 | Logs go to CloudWatch, kept for 14 days, with a request id on every call | 1. Call any endpoint 2. Read the log group `/agentic-lender/al-ai` | One line per request with the `X-Request-ID` value | Pass. The log group keeps 14 days (#247). One line per request with the request id, tested locally (#253, 3 tests). Since #270 the committee also writes one JSON line per run step. `../evidence/al231-evidence-committee-log.txt` is an extract |
| TC-230-03 | `/ai/docs` opens over HTTPS from a browser | Open `https://api.agentic-lender.com/ai/docs` | The API docs page | Pass by `curl` (200, 23 Nov 23:43 UTC). I don't have a browser screenshot of it in the evidence yet |

## AL-231 Live check, docs and teardown (PR #275)

| ID | Acceptance criterion | Steps | Expected result | Result and evidence |
|---|---|---|---|---|
| TC-231-01 | One committee run on the deployed service returns a decision and its log shows the Bedrock call | 1. As `uma`, re-run the committee on an application 2. Read the CloudWatch committee lines | Run complete with a recommendation, the affordability step shows `bedrock qwen.qwen3-32b-v1:0` | Pass, 23 Nov. `al231-evidence-committee-log.txt`: the alice and ben re-runs, affordability `bedrock qwen.qwen3-32b-v1:0` ok (0.5 s, 1.1 s), valuation `groq openai/gpt-oss-120b`, strategist `gemini gemini-3.1-flash-lite`, both finished complete (51.3 s, 42.2 s). `ben-rerun.log`: re-run `c6a2e191…` got to AI Deliberated / complete in about 20 s. `03-committee-three-agents-approve.png`: run `c6a2e191…`, all three votes Approve, affordability provider bedrock |
| TC-231-02 | `docs/infrastructure.md` section 6 no longer says Planned | Read section 6 on `main` | No "Planned" | Pass. PR #275 merged on 24 Nov and changed al-ai, al-core and the portal to "Live since 23 November 2026". There's no "Planned" left in section 6 on `main` |
| TC-231-03 | Screenshots and log extracts go in the Sprint 3 summary | Add them to "Sprint 3 summary - Nic" in Confluence | They're on the page | Not done yet. The files are ready in `../evidence/` (01 to 06, the committee log, the run logs and the down/up times) |
| TC-231-04 | `down` runs at the end of the sprint and its output is saved | `./deploy/al down` | Output saved | Not done yet for the end of the sprint. I ran it once on 23 Nov to time it: 33 destroyed in 4 min 12 s (`07-al-down-up-timed.txt`). I rebuilt the stack straight after, so it's live again. Same as AL-223 TC-223-06: one more `down` on the last day of the sprint |

## End-to-end run on the live stack (supporting evidence)

What the screenshots show, in order, all on `https://agentic-lender.com` on 23 Nov:

| File | Shows |
|---|---|
| `01-loan-file-model-estimate-and-ltv.png` | The loan file with the model estimate and LTV saved by the committee (the fix in #278) |
| `02-valuation-breakdown-shapley.png` | The valuation breakdown in the loan file |
| `03-committee-three-agents-approve.png` | Run `c6a2e191…` complete, 22:56:46 to 22:57:06. Affordability on bedrock `qwen.qwen3-32b-v1:0`, valuation on groq and the strategist, all Approve |
| `04-uma-confirm-approval.png` | The underwriter confirming the approval |
| `05-underwriter-approved-mint-error.png` | The decision is saved (Underwriter Approved) but the first mint failed with "Could not reach the server". The cause was the chain-keys secret holding the wallet address and not the key (`docs/deployment.md` section 9) |
| `06-loan-note-minted.png` | After the fix, "Loan note minted". Token 2 on Polygon Amoy, tx `0x8ff90bdec4dffca38bc6867c90009630f46f7822f140c4ae0ed8da0d6ff38a0e` (AL-231 comment) |

`ben-fresh-application-run.log`: Ben's fresh application `fHrxrx9iHFHvb92mEC23` was submitted at about 22:45:52 UTC and sat at Applied for 613 s with no LTV or risk tier. `docs/deployment.md` section 9 records a run that failed at the strategist being re-run. `ben-rerun.log` is that re-run, complete in about 20 s.

## Notes

1. The fixes the live check found (ECB timeout #269, no CloudWatch trace #270, Gemini 503 retry #276, re-run endpoint #277, estimate and DTI breakdown never saved #278) are listed in `../sprint-3-summary-facts.md`.
