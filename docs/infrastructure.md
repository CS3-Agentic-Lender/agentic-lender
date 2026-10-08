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
| Slack | Day-to-day chat. Channels: general, mobile, web, core, ai | Planned |
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
| Agentic framework | LangGraph (see decision below) | Runs inside the al-ai FastAPI service |
| Predictive ML | scikit-learn (or TensorFlow / Keras) | Trained locally, model file loaded by al-ai |
| LLM inference | Ollama (local) + Groq / Gemini (cloud) | Ollama on laptops that can run it, see below |
| Payments + tooling | Stripe / PayPal sandbox, GitHub, Jira | Sandbox keys in `.env` |

**Decision (Sep 2026): the Python API uses FastAPI.** The brief allows Flask or FastAPI; the team picked FastAPI.

**Decision (Sep 2026): the agent committee uses LangGraph.** The brief allows CrewAI, AutoGen or LangGraph. The committee's steps always run in the same order and each step is our own code, so every AI call is logged exactly: what it was sent and what it sent back. CrewAI adds its own text to prompts, which makes that logging harder, and AutoGen has been in maintenance mode since October 2025.

**Decision (Sep 2026): the live site uses Amazon Bedrock for the local-model role.** The brief asks for a locally hosted model through Ollama. Exposing Ollama on a team laptop to a public site is a security risk, so the app deployed on AWS calls a model on Amazon Bedrock instead. Ollama stays in local development, and at the demo a local run of the app shows Ollama working. The two cloud LLM APIs are unchanged. Agreed with the supervisor. Budget alerts go on the AWS account before anything is deployed.

**Decision (8 Oct 2026): the Bedrock model is Qwen3 32B.** On AWS, the affordability agent uses Qwen3 32B on Bedrock. Locally, it stays on `qwen3.5:9b` through Ollama. Both are Qwen models, so local runs and the live site behave alike.

**Decision (Oct 2026): the live site runs on AWS ECS Fargate behind one load balancer.** al-ai and al-core each run as one Fargate task in eu-west-1. One Application Load Balancer sends `/ai/*` to al-ai and `/core/*` to al-core on one host (`api.<domain>`), with HTTPS from a free AWS certificate. HTTPS needs a domain we own, so the team buys one. A WAF rate limit sits on the load balancer. Keys live in AWS Secrets Manager. The setup is written in Terraform and run with a few simple commands, so it can be built before the demo and destroyed after it. GitHub Actions builds the images when code merges to `main` and a person starts each deploy.

**Decision (Oct 2026): the AWS tasks run in public subnets for the December test week and in private subnets for the demo week if the budget allows.** The task security group accepts traffic only from the load balancer in both cases. Private subnets need a NAT gateway (about EUR 30 a month), so the switch is a single Terraform setting. See `docs/deployment.md`.

**Decision (Oct 2026): cost guardrails are set before anything deploys.** The deployment runs in Nikoloz's AWS account, which Nic sets up and manages with admin access. Nic's own account has no credits left, so until Nikoloz's account is checked every charge counts as real money: about EUR 40 for a test week and a demo week. The guardrails are budget alerts at about EUR 20 and EUR 50 on actual charges, fixed task counts with no autoscaling, the WAF rate limit, and a tear-down after the demo. Nic covers any charges the account's credits do not.

### Design tokens

**Decision (Sep 2026): Pine & Oat, dark green on warm off-white.** Ibrahima and Nikoloz agreed on it, replacing the earlier proposal (palette A, navy and blue). It comes from the [borrower app Figma file](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1), where each token in the first table is a colour variable in the "Pine & Oat" collection. Ibrahima and Nikoloz can change any value, but only when both agree, so the app and the portal stay one product. Record any change here and in the Figma variables.

| Token | Role | Light |
|---|---|---|
| Pine | Actions, selected tabs, progress; text on it is Surface | `#1E342E` |
| Pine pressed | Pressed state of Pine actions | `#142520` |
| Oat | Background | `#F6F4EE` |
| Surface | Cards, panels, fields | `#FFFCF4` |
| Line | Borders, dividers | `#D6DFD4` |
| Tint | Highlight panels, Tint badges | `#E8EFE7` |
| Neutral | Neutral badges, quiet fills | `#EEEBE3` |
| Text | Body text, headers | `#16241D` |
| Muted text | Secondary text | `#4C5851` |
| Success | Positive status text | `#166534` |
| Error | Errors, declined status text | `#991B1B` |

Dark mode is not defined yet. Add it here, and to the Figma variables, when Ibrahima and Nikoloz agree on the values.

Status badges (the Badge component in the Figma file), background / text:

| Tone | Colours | Used for |
|---|---|---|
| Neutral | `#EEEBE3` / `#3F4A44` | Applied, offline |
| Tint | `#E8EFE7` / `#1E342E` | Current step, test mode |
| Success | `#DCFCE7` / `#166534` | Good results (fair price, high score) |
| Danger | `#FEE2E2` / `#991B1B` | Declined, over-priced, low score |
| Pine | `#1E342E` / `#FFFCF4` | Emphasis (the borrower's limit) |

Loan statuses and risk tiers pick from these five tones; the portal's mapping is set when the portal adopts the palette. Every status and tier also shows its name as text, never colour alone.

Type: IBM Plex Sans for the interface, IBM Plex Mono for loan references and figures. Every text colour pair above is at least 6.2:1 contrast, which passes WCAG AA (4.5:1).

### Local development

Goal: the whole app runs on one laptop with no cloud credentials. Status: **Planned**.

| Service | Command | Port |
|---|---|---|
| Firebase Emulator UI | `firebase emulators:start --project demo-al` | 4000 |
| Firebase Auth emulator | (same) | 9099 |
| Firestore emulator | (same) | 8080 |
| Hardhat node | `npx hardhat node` | 8545 |
| al-ai (FastAPI) | TBD | 5001 (avoids clashing with macOS AirPlay Receiver, which often uses 5000) |
| al-core (FastAPI) | Docker Compose, behind the gateway | 5002 |
| Local gateway (nginx) | `docker compose up gateway` (planned) | 8000 |
| Ollama | `ollama serve` | 11434 |
| al-web (Vite) | `npm run dev` | 5173 |

- The local gateway sends `/ai/*` to al-ai and `/core/*` to al-core and applies the same rate limit as the WAF, so developers test the AWS behaviour on a laptop. It does not copy the managed rule sets that AWS WAF adds.
- The `demo-` prefix marks a demo project: no real Firebase project, login or service account is needed, and nothing can reach production resources.
- The emulators need Java 21+ and `firebase-tools` (`npm install -g firebase-tools`).
- The iOS Simulator shares the Mac's network, so it reaches the emulators at `localhost`.
- Clients connect to the emulators only in dev builds (`connectAuthEmulator` / `connectFirestoreEmulator` on web, `useEmulator` on iOS).
- Seed data (one borrower, one broker, one underwriter, a few applications) is loaded with emulator import/export so everyone starts from the same state.

**Ollama.** Local models need a reasonably strong machine (roughly 16 GB+ RAM for an 8B model), so only some laptops run Ollama. If yours can't, don't swap in a cloud model and don't point at someone else's machine. Comment on the Jira ticket, @mention a teammate who runs Ollama, and say exactly what to run (branch, command, expected result). They reply on the ticket with the output.

## 5. Test

| Subsystem | Framework | Workflow | Status |
|---|---|---|---|
| al-mobile | XCTest | `mobile.yml` (Mobile tests) | Done |
| al-web | Vitest | `web.yml` (Web tests) | Ready: first runs on the portal scaffold PR, which brings the first test |
| al-core | Jest Firestore rules tests, in the Firestore emulator | `core.yml` (Core tests) | Done |
| al-core | Hardhat test (Mocha/Chai) | `core.yml` | Planned: a step is added when the contracts exist |
| al-ai | pytest | `ai.yml` (AI tests) | Ready: runs from the first al-ai PR with a `pyproject.toml` and tests |

GitHub Actions runs each suite on every PR, filtered by path so only the changed subsystem runs. A failing test fails that PR's check. Every user story has a written test case in the sprint docs.

## 6. Deploy

Status key as above. Items marked TBD are decided at the team meeting.

| Subsystem | Where it runs | Status |
|---|---|---|
| al-web | Firebase Hosting at `app.<domain>` | Planned |
| al-ai and al-core | AWS ECS Fargate in eu-west-1, one task each, behind one Application Load Balancer at `api.<domain>`. WAF rate limit on the load balancer. Secrets in Secrets Manager. Amazon Bedrock for the affordability agent (section 4) | Planned |
| Infrastructure | Terraform in `deploy/`, run with simple wrapper commands. Images built by GitHub Actions on merge to `main`, deploy started by hand | Planned |
| al-core contracts | Public testnet, Polygon Amoy or Arbitrum Sepolia (Dumi picks) | Decided, network open |
| al-mobile | The App Store through Ibrahima's paid Apple Developer account (end of October 2026). The iOS Simulator is the backup | Decided |

## Open decisions

- Which public testnet the contracts use (Dumi)
- Local dev: whether Docker Compose also wraps Hardhat
