# AL-180: Deploy the al-ai service to AWS

## What I built

I put al-ai on AWS as one ARM64 Fargate task behind `/ai/*` on `api.agentic-lender.com`. It gets its keys from Secrets Manager when the task starts and it runs as a non-root user on a read-only filesystem. On AWS the affordability agent calls Qwen3 32B on Bedrock instead of Ollama and the task role can call that one model and nothing else. Local runs don't change, they still use Ollama.

The first live runs found faults the tests hadn't caught: a slow cold ECB reply, Gemini 503s, no way to re-run a failed run and the model estimate and DTI breakdown never being saved. I fixed each one in its own PR. After that, Ben's application on 23 Nov went from the committee through the underwriter's approval to a loan note minted on Polygon Amoy (token 2).

## Pull requests

| PR | Ticket | Title | Merged | By |
|---|---|---|---|---|
| [#219](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/219) | AL-129 | Add a Bedrock client for the deployed affordability agent | 2026-11-17 | Nic |
| [#247](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/247) | AL-229 | Add al-ai's secrets, log group and ECS roles | 2026-11-18 | Nic |
| [#253](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/253) | AL-230 | Run al-ai on Fargate behind /ai | 2026-11-20 | Nic |
| [#275](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/275) | AL-231 | Update the deployment docs to match what is live | 2026-11-24 | Nic |

Fixes with no ticket that the live check turned up, all merged 23 Nov: [#264](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/264), [#269](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/269), [#270](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/270), [#276](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/276), [#277](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/277), [#278](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/278). A related bug fix that did have a ticket: AL-327, [#254](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/254) (2026-11-20).
