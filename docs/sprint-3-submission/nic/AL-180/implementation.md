# AL-180: Deploy the al-ai service to AWS

## What I built

I put al-ai on AWS as one ARM64 Fargate task (0.5 vCPU, 2 GB) behind `/ai/*` on `api.agentic-lender.com`. It gets its keys from Secrets Manager when the task starts and it runs as a non-root user on a read-only filesystem. On AWS the affordability agent calls Qwen3 32B on Bedrock instead of Ollama and the task role can call that one model and nothing else. Locally it still uses Ollama.

The first live runs on 23 Nov found faults the tests hadn't caught: the committee timed out on a slow ECB reply, it gave up on Gemini 503 errors, a failed run couldn't be re-run and the model estimate and DTI breakdown were never saved. I fixed each one in its own PR. After that, Ben's application went from the committee through the underwriter's approval to a loan note minted on Polygon Amoy (token 2).

## Pull requests

| PR | Ticket | Title | Merged |
|---|---|---|---|
| [#219](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/219) | AL-129 | Add a Bedrock client for the deployed affordability agent | 17 Nov |
| [#247](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/247) | AL-229 | Add al-ai's secrets, log group and ECS roles | 18 Nov |
| [#253](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/253) | AL-230 | Run al-ai on Fargate behind /ai | 20 Nov |
| [#275](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/275) | AL-231 | Update the deployment docs to match what is live | 24 Nov |

All four are mine. Fixes with no ticket, all merged 23 Nov: [#264](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/264) (non-root, read-only filesystem), [#269](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/269) (ECB timeout), [#270](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/270) (committee logs in CloudWatch), [#276](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/276) (Gemini 503 back-off), [#277](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/277) (re-run endpoint), [#278](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/278) (save the estimate and DTI breakdown). A related bug with a ticket: AL-327, [#254](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/254) (20 Nov), which recovers a committee run left "running" by a deploy or crash.
