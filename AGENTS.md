# AL (Agentic Lender)

MTU Year 3 group project (2026/27): a prototype mortgage/HELOC origination platform linking retail borrowers, mortgage brokers and bank underwriters. Graded as a product built in 3 three-week sprints, with a demo on 4 Jan 2027.

## Subsystems and owners

| Dir | Subsystem | Stack | Owner |
|---|---|---|---|
| `al-mobile/` | Borrower Android app | Kotlin | Ibrahima |
| `al-web/` | Broker + underwriter portal | React, React Router, Tailwind | Nikoloz |
| `al-core/` | Database + blockchain | Database (TBD), Solidity, Hardhat | Nic + Dumi |
| `al-ai/` | Property valuation ML + agent committee | Python, Flask, scikit-learn | Nic + Dumi |
| `docs/` | Sprint docs, use cases, test cases, infra outline | Markdown | All |

Stay inside the subsystem the task is about. A change that touches another owner's directory goes in its own PR so that owner reviews it.

Tooling and environment choices are recorded in `docs/infrastructure.md`. Local setup and deploy targets are decided during the sprints: read that file before assuming a tool, and update it when a choice is made.

## Workflow

- One Jira ticket per branch: `feature/AL-<jira-id>-short-description`.
- Every commit message opens with the ticket id: `AL-12 add valuation endpoint`.
- `main` is protected: changes land through a PR with one approval.
- Individual contribution is 25% of the grade, so keep each commit to one person's work and one ticket. That keeps who-did-what readable from the history.

## Secrets

The repo is public, so a committed key is scraped within minutes.

- Keys live in `.env`, which is gitignored. When you add a key to `.env`, add its name with an empty value to `.env.example`.
- Keys are personal (Groq, Gemini, wallet private keys). Testnet wallets only.
- Run `gitleaks git --staged` before committing.
