# AL Infrastructure and Development Environment

Week 3 deliverable. The brief asks for the infrastructure the team uses to **communicate, document, manage code, develop code, test and deploy**. One section per word.

Status key: **Done** / **Planned** / **TBD**

## Team

| Member | Subsystem | GitHub |
|---|---|---|
| Ibrahima Toure Ba | al-mobile (iOS) | @ibratx |
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

The core stack comes from the brief's Technology Stack Summary and is fixed, except where a team decision below changes it.

**Decision (Sep 2026): the borrower app is iOS (Xcode, Swift, SwiftUI).** The brief lists Android Studio and Kotlin. Seamus approved iOS in the team meeting on Thursday 24 September 2026. Xcode is already set up on Ibrahima's Mac, and the iOS Simulator reaches the local emulators at `localhost` and runs lighter than the Android emulator alongside the rest of the local stack. Everything the brief asks of the app works on iOS: Firebase Auth with Google sign-in, the Stripe sandbox SDK, and SwiftUI guidance in `ui-ux-pro-max`. The choice only changes the mobile app's own code; the backend is the same. Trade-off: running the app locally needs a Mac. Teammates try it on their iPhones through Xcode on a Mac (free, reinstalled every 7 days) or TestFlight (paid Apple Developer account).

| Area | Core technology (from brief) | Local setup |
|---|---|---|
| al-mobile | iOS (Xcode, Swift, SwiftUI), Firebase Auth: see decision above | iOS Simulator, pointed at the Firebase emulators |
| al-web | React, React Router, Tailwind CSS | Vite dev server, pointed at the Firebase emulators |
| Database + API | Firebase (Firestore, Auth), Python (FastAPI, see decision below) | Firebase Emulator Suite |
| Blockchain / ledger | Solidity, Hardhat, Ethers.js / Web3.py | `npx hardhat node` (optionally in Docker Compose) |
| Agentic framework | CrewAI, AutoGen or LangGraph | Runs inside the al-ai FastAPI service |
| Predictive ML | scikit-learn (or TensorFlow / Keras) | Trained locally, model file loaded by al-ai |
| LLM inference | Ollama (local) + Groq / Gemini (cloud) | Ollama on laptops that can run it, see below |
| Payments + tooling | Stripe / PayPal sandbox, GitHub, Jira | Sandbox keys in `.env` |

**Decision (Sep 2026): the Python API uses FastAPI.** The brief allows Flask or FastAPI; the team picked FastAPI.

**Decision (Sep 2026): the live site uses Amazon Bedrock for the local-model role.** The brief asks for a locally hosted model through Ollama. Exposing Ollama on a team laptop to a public site is a security risk, so the app deployed on AWS calls a model on Amazon Bedrock instead. Ollama stays in local development, and at the demo a local run of the app shows Ollama working. The two cloud LLM APIs are unchanged. Agreed with the supervisor. Budget alerts go on the AWS account before anything is deployed.

### Design tokens

**Proposed (Sep 2026): palette A, navy and blue.** The team picked it from the `ui-ux-pro-max` palettes and removed the gold accent. Ibrahima and Nikoloz can change any value, but only when both agree, so the app and the portal stay one product. Record any change here. Clickable prototype: [AL Palette Trial](https://claude.ai/artifact/UosWe8v9iAGRLCtsAVfvKQ) (private, ask Nic for access).

| Role | Light | Dark |
|---|---|---|
| Ink: navigation, headers | `#0F172A` | `#070D19` |
| Navy: logo, selected tabs, progress | `#1E3A8A` | `#60A5FA` |
| Action: buttons, links | `#0369A1`, white text | `#38BDF8`, text `#082F49` |
| Background | `#F8FAFC` | `#0B1220` |
| Surface: cards, panels | `#FFFFFF` | `#111B2E` |
| Text | `#0F172A` | `#E2E8F0` |
| Muted text | `#475569` | `#94A3B8` |
| Border | `#E2E8F0` | `#23304A` |

Loan status badges, background / text in light mode:

| Status | Colours | Risk tier | Colours |
|---|---|---|---|
| Applied | `#F1F5F9` / `#334155` | A | `#DCFCE7` / `#166534` |
| AI deliberated | `#EDE9FE` / `#5B21B6` | B | `#ECFCCB` / `#3F6212` |
| Underwriter approved | `#DCFCE7` / `#166534` | C | `#FEF3C7` / `#92400E` |
| Funded | `#DBEAFE` / `#1E40AF` | D | `#FEE2E2` / `#991B1B` |
| Closed | `#E2E8F0` / `#1E293B` | | |
| Declined | `#FEE2E2` / `#991B1B` | | |

The dark-mode badge values are in the prototype. Every status and tier also shows its name as text, never colour alone.

Type: IBM Plex Sans for the interface, IBM Plex Mono for loan references and figures. Every text colour pair above, light and dark, is at least 5.6:1 contrast, which passes WCAG AA (4.5:1).

### Local development

Goal: the whole app runs on one laptop with no cloud credentials. Status: **Planned**.

| Service | Command | Port |
|---|---|---|
| Firebase Emulator UI | `firebase emulators:start --project demo-al` | 4000 |
| Firebase Auth emulator | (same) | 9099 |
| Firestore emulator | (same) | 8080 |
| Hardhat node | `npx hardhat node` | 8545 |
| al-ai (FastAPI) | TBD | 5001 (avoids clashing with macOS AirPlay Receiver, which often uses 5000) |
| Ollama | `ollama serve` | 11434 |
| al-web (Vite) | `npm run dev` | 5173 |

- The `demo-` prefix marks a demo project: no real Firebase project, login or service account is needed, and nothing can reach production resources.
- The emulators need Java 11+ and `firebase-tools` (`npm install -g firebase-tools`).
- The iOS Simulator shares the Mac's network, so it reaches the emulators at `localhost`.
- Clients connect to the emulators only in dev builds (`connectAuthEmulator` / `connectFirestoreEmulator` on web, `useEmulator` on iOS).
- Seed data (one borrower, one broker, one underwriter, a few applications) is loaded with emulator import/export so everyone starts from the same state.

**Ollama.** Local models need a reasonably strong machine (roughly 16 GB+ RAM for an 8B model), so only some laptops run Ollama. If yours can't, don't swap in a cloud model and don't point at someone else's machine. Comment on the Jira ticket, @mention a teammate who runs Ollama, and say exactly what to run (branch, command, expected result). They reply on the ticket with the output.

## 5. Test

| Subsystem | Framework | Status |
|---|---|---|
| al-mobile | XCTest | Planned |
| al-web | Vitest | Planned |
| al-core | Hardhat test (Mocha/Chai) | Planned |
| al-ai | pytest | Planned |

GitHub Actions runs each suite on every PR, filtered by path so only the changed subsystem runs. Every user story has a written test case in the sprint docs.

## 6. Deploy

Deployment targets are decided as each subsystem becomes deployable. This section is updated when a choice is made.

| Subsystem | Options under consideration | Status |
|---|---|---|
| al-web | Firebase Hosting | Planned |
| al-ai | AWS: API container behind a load balancer, Amazon Bedrock for the local-model role (see section 4) | Planned |
| al-core contracts | Local Hardhat node, Polygon Amoy or Arbitrum Sepolia testnet | TBD |
| al-mobile | iOS Simulator build, or an iPhone signed with a free Apple ID (the app expires after 7 days), for the demo. TestFlight needs a paid Apple Developer account | TBD |

## Open decisions

- Chat platform: Discord or Teams
- Local dev: al-ai run command and whether Docker Compose wraps Hardhat + FastAPI (section 4)
- Deployment targets (section 6)
- Colour palette: palette A is proposed (section 4, Design tokens); final once Ibrahima and Nikoloz both agree
- Custom feature (OCR, green mortgage, FTB explainer bot, amenity scoring)
- Agent framework: CrewAI, AutoGen or LangGraph
