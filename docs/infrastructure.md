# AL Infrastructure and Development Environment

Week 3 deliverable. The brief asks for the infrastructure the team uses to **communicate, document, manage code, develop code, test and deploy**. One section per word.

Status key: **Done** / **Planned** / **TBD**

## Team

| Member | Subsystem | GitHub |
|---|---|---|
| Ibrahima Toure Ba | al-mobile (Android, Kotlin) | @ibratx |
| Nikoloz Chilachava | al-web (React, Tailwind) | @NikolozChilachava |
| Nicholas Groenewald | al-ai (AI engine) | @NicGroenewald |
| Solomon (Dumi) Sosanya | al-core (database + blockchain) | @solomon-bit76 |

Every external service has two admins so no single person blocks the team.

## 1. Communicate

| Tool | Purpose | Status |
|---|---|---|
| Discord / Teams (TBD) | Day-to-day chat. Channels: general, mobile, web, core, ai | TBD |
| Weekly standup | Progress, blockers, next actions | Planned |
| Email to supervisor | Formal meeting requests, kept as evidence | Planned |

Meeting notes go in Confluence. Each has a Decisions section and an Actions section, and every action has an owner and a due date.

## 2. Document

| Tool | Purpose | Status |
|---|---|---|
| Confluence | Meeting notes, sprint backlogs, retros, use cases | TBD |
| `docs/` in repo | Technical docs that live next to the code | Done |
| Figma | Mock-ups and per-story wireframes | TBD |
| `AGENTS.md` (+ `CLAUDE.md` import) | Shared project context for Codex and Claude Code | Done |

Confluence page templates: Meeting Notes, Sprint Backlog, Retrospective, Use Case.

## 3. Manage code

| Tool | Purpose | Status |
|---|---|---|
| GitHub org `CS3-Agentic-Lender` | One public monorepo, `agentic-lender` | Done |
| Branch ruleset on `main` | PR required, 1 approval, no direct pushes | Planned |
| `CODEOWNERS` | Auto-requests review from the directory owner | Done |
| Jira (Scrum, space `AL`) | Product backlog, 3 sprints of 3 weeks. Epic = brief feature, Story = user story, subsystem as label | Done |
| GitHub for Atlassian | Branches, commits and PRs containing `AL-xx` link to Jira tickets | Done |
| Jira flows | Branch created → In Progress, PR opened → In Review, PR merged → Done (matched on the `AL-xx` key; a story with open subtasks isn't moved to Done) | Done |
| Secret scanning | betterleaks: `.githooks/pre-commit` on every commit, `Secret scan` GitHub Action on every PR | Done |

Why a monorepo: one history, one CI setup, one link for the supervisor.

Conventions:
- Branch: `feature/AL-<jira-id>-short-description`
- Commit: `AL-12 add valuation endpoint`
- PR title: `AL-12 Add valuation endpoint`
- Exactly one ticket key per branch, commit, PR title and PR description, or the Jira flows move the wrong ticket
- Secrets live in `.env` (gitignored). Every key name is listed in `.env.example`.

## 4. Develop code

The core stack comes from the brief's Technology Stack Summary and is fixed.

| Area | Core technology (from brief) | Local setup |
|---|---|---|
| al-mobile | Android Studio, Kotlin, Firebase Auth | Android emulator, pointed at the Firebase emulators |
| al-web | React, React Router, Tailwind CSS | Vite dev server, pointed at the Firebase emulators |
| Database + API | Firebase (Firestore, Auth), Python (Flask / FastAPI) | Firebase Emulator Suite |
| Blockchain / ledger | Solidity, Hardhat, Ethers.js / Web3.py | `npx hardhat node` (optionally in Docker Compose) |
| Agentic framework | CrewAI, AutoGen or LangGraph | Runs inside the al-ai Flask service |
| Predictive ML | scikit-learn (or TensorFlow / Keras) | Trained locally, model file loaded by al-ai |
| LLM inference | Ollama (local) + Groq / Gemini (cloud) | Ollama on laptops that can run it, see below |
| Payments + tooling | Stripe / PayPal sandbox, GitHub, Jira | Sandbox keys in `.env` |

### Local development

Goal: the whole app runs on one laptop with no cloud credentials. Status: **Planned**.

| Service | Command | Port |
|---|---|---|
| Firebase Emulator UI | `firebase emulators:start --project demo-al` | 4000 |
| Firebase Auth emulator | (same) | 9099 |
| Firestore emulator | (same) | 8080 |
| Hardhat node | `npx hardhat node` | 8545 |
| al-ai (Flask) | TBD | 5001 (avoids clashing with macOS AirPlay Receiver, which often uses 5000) |
| Ollama | `ollama serve` | 11434 |
| al-web (Vite) | `npm run dev` | 5173 |

- The `demo-` prefix marks a demo project: no real Firebase project, login or service account is needed, and nothing can reach production resources.
- The emulators need Java 11+ and `firebase-tools` (`npm install -g firebase-tools`).
- The Android emulator reaches the host machine at `10.0.2.2`, not `localhost`.
- Clients connect to the emulators only in dev builds (`connectAuthEmulator` / `connectFirestoreEmulator` on web, `useEmulator` on Android).
- Seed data (one borrower, one broker, one underwriter, a few applications) is loaded with emulator import/export so everyone starts from the same state.

**Ollama.** Local models need a reasonably strong machine (roughly 16 GB+ RAM for an 8B model), so only some laptops run Ollama. If yours can't, don't swap in a cloud model and don't point at someone else's machine. Comment on the Jira ticket, @mention a teammate who runs Ollama, and say exactly what to run (branch, command, expected result). They reply on the ticket with the output.

## 5. Test

| Subsystem | Framework | Status |
|---|---|---|
| al-mobile | JUnit | Planned |
| al-web | Vitest | Planned |
| al-core | Hardhat test (Mocha/Chai) | Planned |
| al-ai | pytest | Planned |

GitHub Actions runs each suite on every PR, filtered by path so only the changed subsystem runs. Every user story has a written test case in the sprint docs.

## 6. Deploy

Deployment targets are decided as each subsystem becomes deployable. This section is updated when a choice is made.

| Subsystem | Options under consideration | Status |
|---|---|---|
| al-web | Firebase Hosting | Planned |
| al-ai | Render, Fly.io | TBD |
| al-core contracts | Local Hardhat node, Polygon Amoy or Arbitrum Sepolia testnet | TBD |
| al-mobile | APK built as a GitHub Actions artifact | TBD |

## Open decisions

- Chat platform: Discord or Teams
- Local dev: al-ai run command and whether Docker Compose wraps Hardhat + Flask (section 4)
- Deployment targets (section 6)
- Custom feature (OCR, green mortgage, FTB explainer bot, amenity scoring)
- Agent framework: CrewAI, AutoGen or LangGraph
