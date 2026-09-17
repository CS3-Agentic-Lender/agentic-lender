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

### The ticket key rules everything

Jira flows read the `AL-<number>` key out of the branch name, the commit messages and the PR title, and move that ticket: branch created → In Progress, PR opened → In Review, PR merged → Done.

So each of those three carries **exactly one** key, and it is the key of the ticket being worked on. A second key anywhere in them transitions a ticket nobody touched. Related tickets are named in the PR body, which no flow reads.

Work on a Subtask uses the **Subtask's** key, not its parent Story's.

### Before starting

1. Get the ticket key from the user, or find it in Jira. No ticket, no work: stop and ask which ticket to use, or create one (`docs/agents/issue-tracker.md`). Never invent a key.
2. Read the ticket with `getJiraIssue` to confirm the key exists and matches the work. A key that 404s is the wrong key.
3. Branch from up-to-date `main`: `git fetch origin && git switch -c <branch> origin/main`.

### Formats

| Thing | Format | Example |
|---|---|---|
| Branch | `feature/AL-<number>-short-description`, lowercase, hyphens, no other key | `feature/AL-54-firebase-auth` |
| Commit subject | `AL-<number> <imperative summary>`, lowercase after the key, no full stop | `AL-54 add google sign-in provider` |
| PR title | `AL-<number> <Sentence case summary>` | `AL-54 Add Google sign-in provider` |

A commit that fixes a review comment keeps the same key; never renumber mid-branch. `chore/`, `fix/` and bare branch names are not used: every branch is `feature/AL-…`, whatever the work type.

### Opening the PR

- Base `main`. Write the body with the `pr` skill: what changed, evidence it works, and merge risk. Related ticket keys go here, not in the title.
- `main` is protected: one approval from a teammate, and the `Secret scan` check green, before merge.
- Never `git push` to `main`, never force-push a shared branch, never `--no-verify`.

### One person, one ticket, one commit

Individual contribution is 25% of the grade and is read from the git history. Keep each commit to one person's work on one ticket. If a change belongs to another owner's directory, it goes in its own PR on its own ticket so that owner reviews it.

## Secrets

The repo is public, so a committed key is scraped within minutes.

- Keys live in `.env`, which is gitignored. When you add a key to `.env`, add its name with an empty value to `.env.example`.
- Keys are personal (Groq, Gemini, wallet private keys). Testnet wallets only.
- betterleaks scans every commit (`.githooks/pre-commit`) and every PR (`.github/workflows/secret-scan.yml`). Never bypass it with `--no-verify`. If it flags something, stop and show the user the finding.
