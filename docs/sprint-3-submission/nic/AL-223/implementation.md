# AL-223: Set up the shared AWS infrastructure with Terraform

## What was built

I built the shared AWS setup in Terraform and split it into two folders. `deploy/foundations` holds what stays up between demos: the state bucket, the DNS zone and certificate, the ECR registries (where the images are stored), the secrets, the IAM roles and the Amplify portal at `agentic-lender.com`. `deploy/app` holds what's billed by the hour: the network, the load balancer with its WAF, the alarms and the Fargate services. `./deploy/al` shows each plan in plain words and asks before it applies anything and `down` asks twice. GitHub Actions builds the ARM64 images on every merge to `main` and each workflow signs in with its own role that only trusts `main`. A permissions boundary stops any role reading another service's secrets. On 23 Nov I timed a `down`: it removed 33 resources in 4 min 12 s and the `up` straight after brought them back in 3 min 22 s.

## Pull requests

| PR | Ticket | Title | Merged | By |
|---|---|---|---|---|
| none | AL-224 | Account guardrails (console work: IAM user with MFA, credits check, budget) | 2026-11-17 (Jira Done) | Nic |
| [#224](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/224) | AL-225 | Add Terraform foundations and the al deploy commands | 2026-11-18 | Nic |
| [#234](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/234) | AL-226 | Add the network, load balancer, WAF and alarms | 2026-11-18 | Nic |
| [#236](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/236) | AL-227 | Add the ECR repositories and the ARM64 image build | 2026-11-18 | Nic |
| [#251](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/251) | AL-326 | Add al-core's secrets, log group and ECS roles | 2026-11-18 | Nic |
| [#257](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/257) | AL-228 | Run al-core on Fargate behind /core | 2026-11-23 | Nic |
| [#274](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/274) | AL-228 | Set al-core's Polygon Amoy chain settings on AWS | 2026-11-23 | Nic |
| [#267](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/267) | AL-328 | Host the portal on Amplify at agentic-lender.com | 2026-11-23 | Nic |

Fixes to the same infrastructure that didn't need a ticket, all merged 23 Nov: [#259](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/259), [#260](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/260), [#261](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/261), [#262](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/262), [#263](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/263), [#265](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/265), [#272](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/272). There's one line on each in `../sprint-3-summary-facts.md`.

al-core's Dockerfile is Solomon's (AL-212).
