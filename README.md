# AL (Agentic Lender)

MTU Year 3 Group Project 2026/27. A prototype mortgage and HELOC origination platform that connects retail borrowers, mortgage brokers and bank underwriters. It combines a property valuation model, a multi-agent AI credit committee and smart contracts that mint approved loans as on-chain loan notes.

Demo: Monday 4 January 2027.

## Team

| Area | Who | Owns |
|---|---|---|
| Core (database + blockchain) | Dumi | `al-core/` Firebase, Solidity contracts, Hardhat |
| AI engine | Nic | `al-ai/` valuation model, agent committee, LLMs |
| Frontend (web) | Nikoloz | `al-web/` broker and underwriter portal |
| Frontend (mobile) | Ibrahima | `al-mobile/` borrower Android app |

## Tech stack

The core stack comes from the project brief. Items marked TBD are decided during the sprints and recorded in [docs/infrastructure.md](docs/infrastructure.md).

| Subsystem | Frameworks and tools |
|---|---|
| `al-mobile` | Android Studio, Kotlin, Firebase Auth |
| `al-web` | React, React Router, Tailwind CSS, Firebase Auth |
| `al-core` | Firebase (Firestore, Auth), Solidity, Hardhat, Ethers.js / Web3.py, EVM testnet (Polygon Amoy or Arbitrum Sepolia, TBD) |
| `al-ai` | Python, Flask, scikit-learn, agent framework (CrewAI, AutoGen or LangGraph, TBD), Ollama for local LLMs plus two cloud LLM APIs (Groq, Gemini) |
| Payments | Stripe Sandbox |
| Tooling | GitHub, Jira, GitHub for Atlassian |

## Repo layout

```
al-mobile/      Android app (Kotlin)
al-web/         React portal
al-core/        database + smart contracts
al-ai/          Flask service: valuation model + agent committee
docs/           sprint docs, use cases, test cases, infra outline
docs/agents/    config read by the AI agent skills
.agents/skills/ agent skills (Codex and other agents)
.claude/skills/ agent skills (Claude Code), links into .agents/skills/
AGENTS.md       instructions every AI agent reads (CLAUDE.md imports it)
```

## Getting started

New to the repo? Follow [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md) step by step. Short version:

```bash
git clone https://github.com/CS3-Agentic-Lender/agentic-lender.git
cd agentic-lender
cp .env.example .env
```

Fill in `.env` with your own keys. Keys are personal: everyone makes their own Groq and Gemini accounts and their own testnet wallet.

Per-subsystem setup lands in each folder's own README as the code arrives.

## Workflow

### Jira

All work is tracked in the [AL Jira space](https://alprojectcs3.atlassian.net): 3 sprints of 3 weeks.

| Level | Holds | Brief deliverable |
|---|---|---|
| Epic | One feature from the brief | Use case |
| Story | One user story ("As a ... I ...") | Wireframe + test case |
| Subtask | One person's technical piece of a story | Implementation |
| Task | Non-feature work (CI, retros, docs) | - |
| Bug | A fault found in testing | Fault report |

### Labels

Every Jira item gets one **subsystem** label and, once triaged, one **state** label.

**Subsystem:** `mobile`, `web`, `core`, `ai`, `docs`

| State | Meaning |
|---|---|
| `needs-triage` | Team needs to evaluate it |
| `blocked` | Waiting on a decision or missing information |
| `ready-agent-assisted` | Fully specified; the owner builds it with an AI agent and reviews every change |
| `ready-for-human` | Needs a person: external accounts, judgment calls, manual checks on a device or testnet |
| `wontfix` | Will not be actioned |

`draft-backlog` marks the first-pass backlog that is still under review.

### Branches, commits and PRs

1. Pick a Jira story or task and assign it to yourself.
2. Branch: `feature/AL-<id>-short-description`
3. Commits start with the key: `AL-12 add valuation endpoint`
4. Open a PR into `main`. `main` is protected: one approval, no direct pushes. `CODEOWNERS` requests the right reviewer.

The Jira key in the branch, commits and PR title links them to the ticket automatically.

Individual contribution is 25% of the grade, so keep each commit to one person's work and one ticket.

## AI agents and skills

Every agent reads [AGENTS.md](AGENTS.md). `CLAUDE.md` only imports it, so edit `AGENTS.md`.

| You use | Skills live in |
|---|---|
| Claude Code | `.claude/skills/` |
| Codex or another agent | `.agents/skills/` |

**Keep both folders in sync.** The real files live in `.agents/skills/<name>/`, and `.claude/skills/<name>` is a symlink to it. When you add a skill:

```bash
ln -s ../../.agents/skills/<name> .claude/skills/<name>
```

Both folders must always list the same skills.

The issue-tracker skills (`/to-spec`, `/to-tickets`, `/triage`, `/wayfinder`) work against Jira and need the Atlassian MCP server connected in your agent. Their config is in [docs/agents/](docs/agents/).

### Frontend: ui-ux-pro-max

`ui-ux-pro-max` is **the main skill for all UI work**, on both web and mobile. Use it for every screen so the portal and the Android app share one design system: the same colour, type and spacing tokens. It has stack guidance for React, Tailwind and Jetpack Compose.

[21st.dev](https://21st.dev) is an optional extra for web: ready-made React + Tailwind components. Restyle anything taken from it with the shared tokens.

## Secrets

The repo is public, so a committed key is scraped within minutes.

- Keys live in `.env`, which is gitignored.
- When you add a key, add its name with an empty value to `.env.example`.
- Only use testnet wallets.

Secret scanning for the whole team is being set up (evaluating [betterleaks](https://github.com/betterleaks/betterleaks)).

## Docs

- [Team guide: how we work](https://alprojectcs3.atlassian.net/wiki/spaces/AL/pages/720898/Team+guide+how+we+work) (Confluence): how the team works day to day, in plain English
- [docs/infrastructure.md](docs/infrastructure.md): tools for communicate, document, manage code, develop, test and deploy
- [docs/agents/](docs/agents/): agent skill config
