# AL (Agentic Lender)

MTU Year 3 Group Project 2026/27. A prototype mortgage and HELOC origination platform that connects retail borrowers, mortgage brokers and bank underwriters. It combines a property valuation model, a multi-agent AI credit committee and smart contracts that mint approved loans as on-chain loan notes.

Demo: Monday 4 January 2027.

## Team

| Area | Who | Owns |
|---|---|---|
| Core (database + blockchain) | Dumi | `al-core/` Firebase, Solidity contracts, Hardhat |
| AI engine | Nic | `al-ai/` valuation model, agent committee, LLMs |
| Frontend (web) | Nikoloz | `al-web/` broker and underwriter portal |
| Frontend (mobile) | Ibrahima | `al-mobile/` borrower app (iOS) |

## Tech stack

The core stack comes from the project brief. Items marked TBD are decided during the sprints and recorded in [docs/infrastructure.md](docs/infrastructure.md).

| Subsystem | Frameworks and tools |
|---|---|
| `al-mobile` | iOS (Xcode, Swift, SwiftUI), Firebase Auth |
| `al-web` | React, React Router, Tailwind CSS, Firebase Auth |
| `al-core` | Firebase (Firestore, Auth), Solidity, Hardhat, Ethers.js / Web3.py, EVM testnet (Polygon Amoy or Arbitrum Sepolia, TBD) |
| `al-ai` | Python, FastAPI, scikit-learn, agent framework (CrewAI, AutoGen or LangGraph, TBD), Ollama for local LLMs (Amazon Bedrock on the deployed app) plus two cloud LLM APIs (Groq, Gemini) |
| Payments | Stripe Sandbox |
| Tooling | GitHub, Jira, GitHub for Atlassian |

## Repo layout

```
al-mobile/      mobile app (iOS)
al-web/         React portal
al-core/        database + smart contracts
al-ai/          FastAPI service: valuation model + agent committee
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

### Sprint rules

We are graded sprint by sprint, and each of us is interviewed on our own work, so the rules are strict:

- **Only work on tickets in the active sprint that are assigned to you.** Nothing else gets built, however quick it looks.
- **No building ahead.** If something from a later sprint needs doing now, raise it with the team and we pull the ticket into the sprint first. Working ahead empties the next sprint and leaves nothing to report.
- **Found something else that needs doing?** Make a ticket with `needs-triage`. Don't fold it into what you are already working on.
- **Stay in your own subsystem.** If you need a change in someone else's folder, comment on their ticket.
- **A ticket is Done when** its PR is merged, its acceptance criteria are met, and it is written up in Confluence.

The same rules are in [AGENTS.md](AGENTS.md), and your AI agent checks them before it writes code: it stops if the ticket is missing, not in the active sprint, or not assigned to you.

### Sprint documentation

Every sprint has to leave evidence behind, in one place, in one structure. In the [AL Confluence space](https://alprojectcs3.atlassian.net/wiki/spaces/AL):

```
AL space
├── <Your name>
│   ├── Sprint 1 - Week 3 deliverables - <Your name>
│   │   ├── Sprint 1 summary - <Your name>
│   │   └── supporting pages: diagrams, UI flows, Figma links, test evidence
│   └── Sprint 2 - <sprint name> - <Your name>
└── ...
```

- Folder per person, named with your first name. Folder per sprint inside it, named `Sprint <n> - <sprint name from Jira> - <Your name>`; Confluence will not allow two folders with the same title in a space, which is why your name is on the end.
- The folders already exist, so put your pages straight into your own sprint folder.
- Your sprint summary lists the tickets you finished with links to their PRs, what you built, evidence it works, and anything that slipped.
- Write it as you go. An agent can tidy it or draw diagrams, but the account of your own work is yours, because the interview is worth 25%.

### Branches, commits and PRs

1. Pick a Jira story or task and assign it to yourself.
2. Branch: `feature/AL-<id>-short-description`
3. Commits start with the key: `AL-12 add valuation endpoint`
4. Open a PR into `main`. `main` is protected: one approval, no direct pushes. `CODEOWNERS` requests the right reviewer.

The Jira key in the branch, commits and PR title links them to the ticket automatically.

Individual contribution is 25% of the grade, so keep each commit to one person's work and one ticket.

**You open the PR, not your agent.** Let it write code, commit and push the branch. When it thinks the work is done, it has to stop, tell you what it built and what it ran, and ask. You read the diff, then open the PR yourself. The same goes for marking a draft ready, merging, approving and replying to review comments: a PR asks a teammate for their time and puts your name on the work, so you have to know what is in it. Your agent is told this in [AGENTS.md](AGENTS.md); this is the human half of the same rule.

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

`ui-ux-pro-max` is **the main skill for all UI work**, on both web and mobile. Use it for every screen so the portal and the mobile app share one design system: the same colour, type and spacing tokens. It has stack guidance for React, Tailwind, SwiftUI and Jetpack Compose.

[21st.dev](https://21st.dev) is an optional extra for web: ready-made React + Tailwind components. Restyle anything taken from it with the shared tokens.

## Secrets

The repo is public, so a committed key is scraped within minutes.

- Keys live in `.env`, which is gitignored.
- When you add a key, add its name with an empty value to `.env.example`.
- Only use testnet wallets.

Every commit is scanned by [betterleaks](https://github.com/betterleaks/betterleaks): locally by the `.githooks/pre-commit` hook, and on every PR by the `Secret scan` GitHub Action. Setup is in [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md#5-secret-scanning).

## Docs

- [Team guide: how we work](https://alprojectcs3.atlassian.net/wiki/spaces/AL/pages/720898/Team+guide+how+we+work) (Confluence): how the team works day to day, in plain English
- [docs/infrastructure.md](docs/infrastructure.md): tools for communicate, document, manage code, develop, test and deploy
- [docs/agents/](docs/agents/): agent skill config
