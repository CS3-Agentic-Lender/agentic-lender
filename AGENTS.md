# AL (Agentic Lender)

MTU Year 3 group project (2026/27): a prototype mortgage/HELOC origination platform linking retail borrowers, mortgage brokers and bank underwriters. Graded as a product built in 3 three-week sprints, with a demo on 4 Jan 2027.

## Subsystems and owners

| Dir | Subsystem | Stack | Owner |
|---|---|---|---|
| `al-mobile/` | Borrower Android app | Android Studio, Kotlin, Firebase Auth | Ibrahima |
| `al-web/` | Broker + underwriter portal | React, React Router, Tailwind, Firebase Auth | Nikoloz |
| `al-core/` | Database + blockchain | Firebase (Firestore, Auth), Solidity, Hardhat, Ethers.js / Web3.py | Dumi |
| `al-ai/` | Property valuation ML + agent committee | Python (Flask), scikit-learn, CrewAI / AutoGen / LangGraph, Ollama + Groq / Gemini | Nic |
| `docs/` | Sprint docs, use cases, test cases, infra outline | Markdown | All |

Stay inside the subsystem the task is about. A change that touches another owner's directory goes in its own PR so that owner reviews it.

## Tech stack

The stack is fixed by the brief (`PROJECT GUIDELINES/GroupProject-Year3-2026.pdf`, gitignored). Don't swap a listed technology for an alternative (e.g. Supabase for Firebase) without a team decision recorded in `docs/infrastructure.md`.

- **Database + auth:** Firebase: Cloud Firestore and Firebase Auth (email/password + Google). Mobile and web sign in directly; the Python API verifies Firebase ID tokens.
- **Ledger:** Solidity contracts (ERC-721 loan notes, SHA-256 audit registry) on Hardhat locally, Polygon Amoy or Arbitrum Sepolia as the testnet.
- **LLMs:** at least two cloud APIs (Groq, Gemini) plus one local model through Ollama. Only some laptops can run Ollama. On a machine that can't, never replace the Ollama call with a cloud model, mock it or skip it. Instead, add a comment to the Jira ticket that @mentions a teammate who runs Ollama and lists exactly what to run (branch, command, expected result), then wait for their reply on the ticket.
- **Payments:** Stripe or PayPal sandbox only.

Local development runs on the Firebase Emulator Suite and a local Hardhat node, so no one needs cloud credentials to work. Ports, run commands and setup live in `docs/infrastructure.md`: read it before assuming a tool, and update it when a choice is made.

## Jira

Board: https://alprojectcs3.atlassian.net, space key `AL`, 3 sprints of 3 weeks.

| Level | Holds | Brief deliverable |
|---|---|---|
| Epic | One feature from the brief | Use case |
| Story | One user story ("As a ... I ...") | Wireframe + test case |
| Subtask | One person's technical piece of a story | Implementation |
| Task | Non-feature work (CI, retros, Week 3 docs) | - |
| Bug | A fault found in testing | Fault report |

Label every item with its subsystem: `mobile`, `web`, `core`, `ai`, `docs`. Items tagged `draft-backlog` are the first-pass backlog and still under review.

Assign by subsystem label: `mobile` → Ibrahima (Jira: dosantos2945), `web` → Nikoloz, `core` → Dumi (Jira: solomondunmi1), `ai` → Nic. A story with both a client label (`mobile`/`web`) and a backend label (`core`/`ai`) goes to the client owner, and its backend work gets its own Subtask assigned to the backend owner.

Nic and Dumi keep their backend ticket counts roughly even, so some `core` tickets are assigned to Nic and some `ai` tickets to Dumi. Either of them can pass a ticket to the other: reassign it in Jira and add a comment saying why, so the history shows who did what.

## Agent skills

### Skill folders

Claude Code loads skills from `.claude/skills/`; Codex and other agents load them from `.agents/skills/`. The real files live in `.agents/skills/<name>/`, and `.claude/skills/<name>` is a relative symlink to it (`ln -s ../../.agents/skills/<name> .claude/skills/<name>`). When you add, remove or rename a skill, do it in both folders so they always list the same skills.

### UI work

For any screen or component, on web or mobile, load `ui-ux-pro-max` first. It is the single source for design tokens (colour, type, spacing), so the portal and the Android app look like one product. [21st.dev](https://21st.dev) React + Tailwind components are an optional extra for `al-web`; restyle them with the shared tokens.

### Issue tracker

Jira space `AL`, accessed through the Atlassian MCP tools. See `docs/agents/issue-tracker.md`.

Before any work that reads or updates a ticket, call `atlassianUserInfo` to check the connection. If the Atlassian tools are missing, or return an auth error, stop and ask the user to log in again:

- Claude Code: run `/mcp` in a terminal `claude` session, pick `atlassian`, and log in.
- Codex: run `codex mcp login atlassian`.

Don't guess what a ticket says and don't skip Jira updates because the connection is down. Wait until the user has reconnected.

### Triage labels

`needs-triage`, `blocked`, `ready-agent-assisted`, `ready-for-human`, `wontfix`; bugs are a Jira work type. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Workflow

- Every piece of work starts from a Jira ticket. If there isn't one, stop and ask the user which ticket to use, or create one (see `docs/agents/issue-tracker.md`). Never make up a key and never work without one.
- One ticket per branch: `feature/AL-<jira-id>-short-description`, where `<jira-id>` is the ticket being worked on.
- Every commit message opens with that key: `AL-12 add valuation endpoint`.
- Every PR title opens with that key: `AL-12 Add valuation endpoint`.
- Jira flows move tickets automatically based on the key in the branch name, commit messages and PR title: branch created → In Progress, PR opened → In Review, PR merged → Done. So those three places contain **only** the key of the ticket being worked on. Mention related tickets in the PR description instead.
- `main` is protected: changes land through a PR with one approval.
- Individual contribution is 25% of the grade, so keep each commit to one person's work and one ticket. That keeps who-did-what readable from the history.

## Secrets

The repo is public, so a committed key is scraped within minutes.

- Keys live in `.env`, which is gitignored. When you add a key to `.env`, add its name with an empty value to `.env.example`.
- Keys are personal (Groq, Gemini, wallet private keys). Testnet wallets only.
