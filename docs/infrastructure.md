# AL Infrastructure and Development Environment

Week 3 deliverable. The brief asks for the infrastructure the team uses to **communicate, document, manage code, develop code, test and deploy**. One section per word.

Status key: **Done** / **Planned** / **TBD**

## Team

| Member | Subsystem | GitHub |
|---|---|---|
| Ibrahima Toure Ba | al-mobile (Android, Kotlin) | @ibratx |
| Nikoloz Chilachava | al-web (React, Tailwind) | @NikolozChilachava |
| Nicholas Groenewald | al-core + al-ai (backend) | @NicGroenewald |
| Solomon Sosanya | al-core + al-ai (backend) | TBD |

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
| `CLAUDE.md` | Shared project context for AI coding assistants | Done |

Confluence page templates: Meeting Notes, Sprint Backlog, Retrospective, Use Case.

## 3. Manage code

| Tool | Purpose | Status |
|---|---|---|
| GitHub org `CS3-Agentic-Lender` | One public monorepo, `agentic-lender` | Done |
| Branch ruleset on `main` | PR required, 1 approval, no direct pushes | Planned |
| `CODEOWNERS` | Auto-requests review from the directory owner | Done |
| Jira (Scrum) | Product backlog, 3 sprints of 3 weeks, one epic per subsystem | TBD |
| Jira + GitHub integration | Commits and PRs link to tickets | TBD |
| gitleaks | Secret scanning before commits | Done (local hook) |

Why a monorepo: one history, one CI setup, one link for the supervisor.

Conventions:
- Branch: `feature/AL-<jira-id>-short-description`
- Commit: `AL-12 add valuation endpoint`
- Secrets live in `.env` (gitignored). Every key name is listed in `.env.example`.

## 4. Develop code

The core stack for each subsystem comes from the brief. The local setup around it is decided as the team needs it during the sprints, and this section is updated when a choice is made.

| Subsystem | Core stack (from brief) | Local setup |
|---|---|---|
| al-mobile | Android Studio, Kotlin | TBD |
| al-web | React, React Router, Tailwind | TBD |
| al-core | Firebase (Firestore, Auth), Solidity, Hardhat | TBD |
| al-ai | Python, Flask, scikit-learn, agent framework (CrewAI / AutoGen / LangGraph) | TBD |

Options under consideration: Docker Compose to run the Hardhat node and Flask service together, and Ollama for the local LLM the brief requires.

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
| al-web | Firebase Hosting | TBD |
| al-ai | Render, Fly.io | TBD |
| al-core contracts | Local Hardhat node, Polygon Amoy or Arbitrum Sepolia testnet | TBD |
| al-mobile | APK built as a GitHub Actions artifact | TBD |

## Open decisions

- Chat platform: Discord or Teams
- Local dev setup per subsystem (section 4)
- Deployment targets (section 6)
- Custom feature (OCR, green mortgage, FTB explainer bot, amenity scoring)
