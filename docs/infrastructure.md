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

**Decision (Oct 2026): the platform supports both mortgages and HELOCs.** The brief covers mortgages and home equity lines of credit. Mortgages follow the full flow in the current prototype. HELOCs are a lighter flow on the same pipeline: the borrower chooses the loan type at the start of the application, and status, messaging, payments, broker and underwriter review and the AI committee are shared. The loan note contract stores the loan type. Discussed with Seamus. The HELOC stories are planned and ticketed in the first sprint.

**Decision (Sep 2026): the custom feature is an explainable valuation.** The brief asks for at least one custom feature of our own. For every property estimate, the app and the portal show how much each detail of the house (county, floor area, bedrooms, property type, BER) moved the price compared with a typical listing. It builds on the valuation model, needs no new data source, and shows up in both the borrower app and the underwriter portal.

| Area | Core technology (from brief) | Local setup |
|---|---|---|
| al-mobile | iOS (Xcode, Swift, SwiftUI), Firebase Auth: see decision above | iOS Simulator, pointed at the Firebase emulators |
| al-web | React, React Router, Tailwind CSS | Vite dev server, pointed at the Firebase emulators |
| Database + API | Firebase (Firestore, Auth), Python (FastAPI, see decision below) | Firebase Emulator Suite |
| Blockchain / ledger | Solidity, Hardhat, Ethers.js / Web3.py | `npx hardhat node` (optionally in Docker Compose) |
| Agentic framework | LangGraph (see decision below) | Runs inside the al-ai FastAPI service |
| Predictive ML | scikit-learn (or TensorFlow / Keras) | Trained locally, model file loaded by al-ai |
| LLM inference | Ollama (local, `qwen3.5:9b`) + Gemini and Groq (cloud) | Ollama on laptops that can run it, see below |
| Payments + tooling | Stripe / PayPal sandbox, GitHub, Jira | Sandbox keys in `.env` |

**Decision (Sep 2026): the Python API uses FastAPI.** The brief allows Flask or FastAPI; the team picked FastAPI.

**Decision (Sep 2026): the agent committee uses LangGraph.** The brief allows CrewAI, AutoGen or LangGraph. The committee's steps always run in the same order and each step is our own code, so every AI call is logged exactly: what it was sent and what it sent back. CrewAI adds its own text to prompts, which makes that logging harder, and AutoGen has been in maintenance mode since October 2025.

**Decision (Sep 2026): the live site uses Amazon Bedrock for the local-model role.** The brief asks for a locally hosted model through Ollama. Exposing Ollama on a team laptop to a public site is a security risk, so the app deployed on AWS calls a model on Amazon Bedrock instead. Ollama stays in local development, and at the demo a local run of the app shows Ollama working. The two cloud LLM APIs are unchanged. Agreed with the supervisor. Budget alerts go on the AWS account before anything is deployed.

**Decision (8 Oct 2026): the Bedrock model is Qwen3 32B.** On AWS, the affordability agent uses Qwen3 32B on Bedrock. Locally, it stays on `qwen3.5:9b` through Ollama. Both are Qwen models, so local runs and the live site behave alike.

**How the Bedrock variant is wired (AL-129).** The model ID is `qwen.qwen3-32b-v1:0` on the `bedrock-runtime` Converse API in `eu-west-1` (Ireland), the same Region as the deployment. AWS lists Qwen3 32B as In-Region only there (no cross-Region inference profile), so borrower data sent to the model stays in Ireland. It supports Bedrock structured outputs, so the reply is checked against the same JSON schema as every other provider. Other EU Regions that serve it: Frankfurt, Stockholm, Milan, London. The deployed app sets `AL_AGENTS_CONFIG=agents.aws.json`, which is `agents.json` with only the affordability agent moved to Bedrock. Nothing sets it locally, so local runs keep Ollama. Bedrock has no API key: requests are signed with the ECS task role, which needs `bedrock:InvokeModel` on that model only (`arn:aws:bedrock:eu-west-1::foundation-model/qwen.qwen3-32b-v1:0`).

**Decision (28 Oct 2026): the valuation agent runs on Groq gpt-oss-120b and Mistral is dropped.** The plan was Mistral Small 4 as the main model, but Mistral has no free API tier: its Free plan is chat only and an API key needs the paid pay-as-you-go plan with a card. Nic proposed Groq `gpt-oss-120b` in `#announcements` on 27 Oct and Ibrahima, Nikoloz and Solomon all agreed in the thread. The valuation agent only explains numbers our code already worked out, so the model cannot change a figure. The manual backup in `agents.json` is Gemini Flash-Lite (`gemini-3.1-flash-lite`), because we already have a free key for it. It is switched by hand: if Groq is down or rate-limited, a person changes the agent's model setting. The code never falls back on its own, so the log of every call always shows the model that really answered. The other agents are unchanged: Gemini for Market & Macro and the strategist, and Ollama for the affordability agent. Gemini and Groq are the two cloud APIs and Ollama is the local model, which meets the brief. Groq's rate limits are why the valuation agent was first moved off Groq's Llama 3.3 70B, so for the demo we run from a saved run first (`al-ai/docs/valuation-agent-runs.json`) in case Groq limits us.

**Smoke test (27 Oct 2026): the model IDs that passed.** A tiny structured-output request passed on Gemini `gemini-3.1-flash-lite` (free tier, 500 requests a day), on Ollama `qwen3.5:9b` and on Groq `openai/gpt-oss-120b`. Mistral was never tested because it has no free API. The IDs are pinned in `al-ai/app/llm/agents.json` and the results are in `al-ai/docs/llm-smoke-results.json`. Gemini and Groq free keys may send requests to the provider to improve its products, so only made-up data goes through them.

**Decision (Oct 2026): the live site runs on AWS ECS Fargate behind one load balancer.** al-ai and al-core each run as one Fargate task (ARM64) in eu-west-1. One Application Load Balancer sends `/ai/*` to al-ai and `/core/*` to al-core on one host (`api.<domain>`), with HTTPS from a free AWS certificate. HTTPS needs a domain we own, so the team buys one. A WAF rate limit sits on the load balancer. Keys live in AWS Secrets Manager. The setup is written in Terraform and run with a few simple commands, so it can be built before the demo and destroyed after it. GitHub Actions builds the ARM64 images when code merges to `main` (laptops only build images for local testing) and a person starts each deploy.

**Decision (Oct 2026): the AWS tasks run in public subnets for the Sprint 3 test run and in private subnets for the demo week if the budget allows.** The task security group accepts traffic only from the load balancer in both cases. Private subnets need a NAT gateway (about EUR 30 a month), so the switch is a single Terraform setting. See `docs/deployment.md`.

**Decision (Oct 2026): cost guardrails are set before anything deploys.** The deployment runs in Nikoloz's AWS account, which Nic sets up and manages with admin access. Nic's own account has no credits left, so until Nikoloz's account is checked every charge counts as real money: about EUR 40 for the Sprint 3 test run and demo week. The guardrails are budget alerts at about EUR 20 and EUR 50 on actual charges, fixed task counts with no autoscaling, the WAF rate limit, and a tear-down after the demo. Nic covers any charges the account's credits do not.

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
| Neutral | `#EEEBE3` / `#3F4A44` | Draft, Applied, Closed, offline |
| Tint | `#E8EFE7` / `#1E342E` | AI Deliberated, current step, test mode |
| Success | `#DCFCE7` / `#166534` | Underwriter Approved, Funded, good results (fair price, high score) |
| Danger | `#FEE2E2` / `#991B1B` | Declined, over-priced, low score |
| Pine | `#1E342E` / `#FFFCF4` | Emphasis (the borrower's limit) |

Loan statuses pick from these tones, and the borrower app and the portal will use the same mapping:

| Lifecycle status | Tone |
|---|---|
| Draft, Applied, Closed | Neutral |
| AI Deliberated | Tint |
| Underwriter Approved, Funded | Success |
| Declined | Danger |

Risk tiers (A to D) are shown as plain text for now. The palette has no amber or warning tone, so one is added only when Ibrahima and Nikoloz agree a shared token and record it here. Neither app offers a theme choice: both use Pine & Oat in light mode only. Every status and tier also shows its name as text, never colour alone.

Type: IBM Plex Sans for the interface, IBM Plex Mono for loan references and figures. Every text colour pair above is at least 6.2:1 contrast, which passes WCAG AA (4.5:1).

### Local development

Goal: the whole app runs on one laptop with no cloud credentials. Status: **Planned**.

| Service | Command | Port |
|---|---|---|
| Firebase Emulator UI | `firebase emulators:start --project demo-al` | 4000 |
| Firebase Auth emulator | (same) | 9099 |
| Firestore emulator | (same) | 8080 |
| Hardhat node | `npx hardhat node` | 8545 |
| al-ai (FastAPI) | `docker compose up --build` (starts al-ai, al-core and the gateway) | 5001 (avoids clashing with macOS AirPlay Receiver, which often uses 5000) |
| al-core (FastAPI) | Docker Compose, behind the gateway | 5002 |
| Local gateway (nginx) | `docker compose up --build` (starts with al-ai and al-core) | 8000 |
| Ollama | `ollama serve` | 11434 |
| al-web (Vite) | `npm run dev` | 5173 |

- The local gateway sends `/ai/*` to al-ai and `/core/*` to al-core and applies the same rate limit as the WAF, so developers test the AWS behaviour on a laptop. It does not copy the managed rule sets that AWS WAF adds.
- The `demo-` prefix marks a demo project: no real Firebase project, login or service account is needed, and nothing can reach production resources.
- The emulators need Java 21+ and `firebase-tools` (`npm install -g firebase-tools`).
- The iOS Simulator shares the Mac's network, so it reaches the emulators at `localhost`.
- Clients connect to the emulators only in dev builds (`connectAuthEmulator` / `connectFirestoreEmulator` on web, `useEmulator` on iOS).
- Seed data (one borrower, one broker, one underwriter, a few applications) is loaded with emulator import/export so everyone starts from the same state.

**Gateway and al-ai.** `docker compose up --build` from the repo root starts al-ai (5001), al-core (5002) and an nginx gateway on `localhost:8000`, the stand-in for `api.<domain>` on AWS. Clients call the gateway: `/ai/*` goes to al-ai, `/core/*` to al-core.

- Start the Firebase emulators on the host first (`firebase emulators:start --project demo-al`). The al-ai container reaches the Auth emulator at `host.docker.internal:9099` through `FIREBASE_AUTH_EMULATOR_HOST`, with `FIREBASE_PROJECT_ID=demo-al`. Both are set in `docker-compose.yml`.
- Docker Compose wraps al-ai, al-core and the gateway. al-core and al-ai both reach the Firestore emulator, at `host.docker.internal:8080` through `FIRESTORE_EMULATOR_HOST`. al-ai needs it for the ECB rate cache (`rates_cache`): without it `/ai/affordability` answers 503. It also needs it for the committee listener, which is off by default and starts with `AUTO_START_COMMITTEE=true`. Whether it also wraps Hardhat is an open decision below. The Firebase emulators stay on the host because they need Java.
- Without Docker: `cd al-ai && FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 uv run uvicorn app.main:app --port 5001`, then call `localhost:5001` directly.
- Browser origins: al-ai answers CORS only for the origins in the `CORS_ALLOWED_ORIGINS` setting (comma separated). With no setting it allows `http://localhost:5173`, the local portal, and no other origin. On AWS it is set to `https://agentic-lender.com`, the deployed portal (`deploy/app/ecs.tf`). A wildcard is refused. The setting lives in `al-ai/app/cors.py`. al-core needs the same setting on its own ticket.
- Gateway limits per IP: 300 requests per 5 minutes, 20 `POST /core/me` per minute, then `429` with `Retry-After`. nginx uses a leaky bucket rather than a rolling window, so the limits are sized as a ceiling: a full burst is allowed, then sustained traffic is held to half the limit (30 requests a minute). `python3 gateway/check_limits.py` checks it against a running stack.

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

**al-ai thread cap.** `al-ai/tests/conftest.py` caps numpy, scikit-learn and joblib at 2 threads during tests (`OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS`, `LOKY_MAX_CPU_COUNT`). Uncapped, a full run peaked at about 17 cores; capped it peaks at about 2 and finishes slightly faster, because the threads no longer fight over the cores. A value you set wins, e.g. `OMP_NUM_THREADS=8 uv run pytest`. Only the tests are capped, not the app or the training scripts.

### UI tests (al-mobile)

`AgenticLenderUITests` drives the iOS app end to end against the local stack: submitting a mortgage application, seeing a status change live on the status screen, and picking a saved property check in the application form. They run on a Mac only, before a merge or a demo. CI doesn't run them, because it has no emulators: they sit in their own `AgenticLenderUITests` scheme, and `mobile.yml` runs the `AgenticLender` scheme's unit tests as before.

1. Start the emulators with the seed data: `cd al-core && firebase emulators:start --project demo-al --import=./seed-data`
2. Start the gateway, al-core and al-ai from the repo root: `docker compose up -d --build`
3. Run the tests: `./al-mobile/run-ui-tests.sh` (any iPhone Simulator; set `SIMULATOR_ID` to pick one)

Each test makes its own borrower, signs in as them, and deletes them and everything they created when it finishes, so the tests run in any order and leave the seed data as it was. The app starts signed out in these tests (`UITestLaunch`, Debug builds only).

## 6. Deploy

Status key as above. Items marked TBD are decided at the team meeting.

| Subsystem | Where it runs | Status |
|---|---|---|
| Firestore and Auth (hosted) | Firebase project `agentic-lender-a0f1c`, Firestore in europe-west1 (see below) | Done |
| al-web | AWS Amplify Hosting at `agentic-lender.com` (`www.` redirects to it), built and uploaded by GitHub Actions (`portal.yml`), made by Terraform in `deploy/foundations/portal.tf`. Steps in `deploy/README.md` under "The portal" | Live since 23 November 2026. The seeded borrower, broker and underwriter accounts sign in |
| al-ai and al-core | AWS ECS Fargate (ARM64) in eu-west-1, one task each, behind one Application Load Balancer at `api.agentic-lender.com`: al-ai under `/ai`, al-core under `/core`. WAF rate limit on the load balancer, with request sampling off. Secrets in Secrets Manager. Amazon Bedrock for the affordability agent (section 4). al-ai runs as a non-root user on a read-only root filesystem, and each committee run logs one JSON line per step to `/agentic-lender/al-ai`. al-core's Polygon Amoy settings are not in the task definition yet, so it can't mint from AWS. The Stripe webhook is not set up on AWS yet | Live since 23 November 2026 |
| Infrastructure | Terraform in `deploy/`, run with `./deploy/al`. Images built by GitHub Actions on merge to `main` with their own push-only role, and kept in ECR for 90 days. Deploy started by hand. Alarms email two people. A budget action locks the GitHub deploy role when spend reaches the USD 50 monthly budget | Live since 23 November 2026 |
| al-core contracts | Polygon Amoy, chosen by Dumi (AL-183). Both contracts deployed and source-verified on 23 November 2026, see "Contracts on Polygon Amoy" below | Deployed and verified, mint from AWS pending |
| al-mobile | The demo build (`AL_BACKEND=HOSTED`) on the iOS Simulator on the presenting Mac, against the hosted Firebase project and the API on AWS. An iPhone through Xcode with a free Apple ID is the alternative. No App Store or TestFlight: that needs a paid Apple Developer account. See "Demo build of the iOS app" below. Chosen by Ibrahima on 18 November (AL-184) and agreed by Nic in the PR review | Decided |

### Demo build of the iOS app

The app has two builds, picked by the `AL_BACKEND` build setting (AL-184). `LOCAL`, the default, uses the emulators and the local gateway. `HOSTED` is the demo build: the hosted Firebase project below and the API at `https://api.agentic-lender.com`.

- **Target:** the iOS Simulator on the Mac that presents the demo. Add `AL_BACKEND = HOSTED` to `al-mobile/Config/Hosted.xcconfig` and press Run in Xcode, or build it with `xcodebuild … AL_BACKEND=HOSTED` and install it with `xcrun simctl install booted` (`al-mobile/README.md`, "Demo build"). The setting lives in the xcconfig, not on the target, so Xcode's Run builds what the file says. An iPhone through Xcode with a free Apple ID also works, but the install stops opening after 7 days and has to be run from Xcode again ("Running on your own iPhone").
- **Settings:** the hosted project's iOS app values go in the gitignored `al-mobile/Config/Hosted.xcconfig` (copy `Config/Hosted.example.xcconfig`), so they never reach the public repo. Without them a `HOSTED` build stops at launch and names the missing ones.

### Hosted Firebase project

The emulators (`demo-al`) cover local work. The deployed app and portal use a real Firebase project, set up on 18 November 2026 (AL-181).

| Setting | Value |
|---|---|
| Project name and ID | Agentic-Lender, `agentic-lender-a0f1c` |
| Project number | 1005831067500 |
| Plan | Spark (free), no billing account |
| Firestore | `(default)` database in **europe-west1 (Belgium)**, production mode. Google Cloud has no Irish region, and Belgium keeps the data in the EU. The location can't be changed later |
| Sign-in | Email/Password and Google. The public name on Google's sign-in screen is "Agentic Lender" |
| iOS app | Bundle ID `ie.mtu.agenticlender`. Its `GoogleService-Info.plist` and the API key in it are shared in a DM, never in the repo |
| Rules and indexes | Deployed from the repo, so they are the same as on the emulators: `cd al-core && firebase deploy --only firestore:rules,firestore:indexes --project agentic-lender-a0f1c` |
| Access | Two owners, as every external service has two admins: Dumi, and Nic (added on 18 November under Project settings, Users and permissions, where he is listed as an Owner) |

**Demo accounts.** Created by `al-core/scripts/create-hosted-accounts.js` (see `al-core/README.md`), which sets each account's `role` claim and `users/{uid}` profile. They use `@example.com`, not the emulator's `@test.com`: test.com is a real domain, and the app's "resend verification email" would send mail to its owner. No applications are seeded here.

| Login | Role | Email verified |
|---|---|---|
| alice@example.com | borrower (broker Bob) | yes |
| ben@example.com | borrower (broker Ciara) | no, so the verify-email banner shows |
| bob@example.com | broker | yes |
| ciara@example.com | broker | yes |
| uma@example.com | underwriter | yes |

All five share one password, which Dumi sends to the team privately. It is not in the repo, Slack channels or these docs. The script needs a service account key for the project. It is kept outside the repo, and the one used on 18 November was deleted from the console and from the laptop as soon as the accounts existed. To run the script again, generate a new key (Project settings, Service accounts) and delete it afterwards.

**Checked on 18 November:** all five accounts exist with the right role claims and profiles, and unauthenticated reads of `applications`, `users`, `reviews` and `support_requests` are refused (HTTP 403), so the repo's rules are live.

**The deployed rules, checked with real sign-ins (AL-321, 18 November):** `al-core/scripts/check-hosted-rules.js` signed in on `agentic-lender-a0f1c` as Alice (borrower), Bob (broker) and Uma (underwriter), confirmed each ID token carries the right `role`, and sent 96 requests to Firestore: 59 reads that should be allowed or refused for each person and for no sign-in, and 37 writes and deletes, which no client may do. Every one got the answer the rules should give (alice 27, bob 26, uma 27, signed out 16). The expected answers are the same table that `test/hosted-rules-probes.test.js` replays through the rules engine on the emulator, so the hosted project and the emulator are held to one list. Re-run it whenever the rules are redeployed (`al-core/README.md` says how).

### Contracts on Polygon Amoy

The live site can't reach a Hardhat node on a laptop, so the contracts run on Polygon Amoy (chain id 80002), deployed on 23 November 2026 (AL-183). Amoy over Arbitrum Sepolia: Polygon's own faucet gives 1 POL per claim after a GitHub sign-in, with no mainnet balance needed, and Amoy is the network `hardhat.config.js` and al-core already named. Both contracts' source is verified, so anyone can read the code and every call on the explorer.

| What | Value |
|---|---|
| LoanNote | [`0x12df1c6F6457F337190791527667B8BA4EACEFD4`](https://amoy.polygonscan.com/address/0x12df1c6F6457F337190791527667B8BA4EACEFD4#code) |
| AuditRegistry | [`0x0AA97a061607DF09e1acC208dEf71D7d2D5af3C7`](https://amoy.polygonscan.com/address/0x0AA97a061607DF09e1acC208dEf71D7d2D5af3C7#code) |
| Deployer, admin and holder of every note (the bank) | `0x17f82f0f7a0220FfAc2096a506c41A315c7a1eC6`. Its key is in `al-core/chain/.env` on Dumi's laptop, with a backup in Dumi's password manager, so a lost laptop doesn't lose the admin role. It is needed only to hand on a role or deploy again, never by the running app |
| Minter and registrar (al-core's wallet) | `0x1F747BCB55a0e8D960e1709B4BD4fD7c03d03092`. Its key is in `al-core/chain/.env` and in AWS as `agentic-lender/al-core/chain-keys` |
| RPC | `https://polygon-amoy-bor-rpc.publicnode.com` (free, no key, so it is a plain setting, not a secret) |
| Explorer | https://amoy.polygonscan.com |
| Deployed in | block 53619738 (LoanNote) and 53619740 (AuditRegistry) |
| Record in the repo | `al-core/chain/deployments/amoy.json` (addresses and `deployBlock`, nothing secret) |

Both wallets are testnet-only, funded from the Polygon faucet. al-core's settings on AWS: `CHAIN_NETWORK=amoy`, `CHAIN_RPC_URL`, `LOAN_NOTE_ADDRESS` and `AUDIT_REGISTRY_ADDRESS` as above, `CHAIN_START_BLOCK=53619738`, and the two keys from the secret. The start block matters because PublicNode refuses a log query over 10,000 blocks and Amoy makes about 43,000 a day: al-core looks a past mint, close or audit write up newest first in 10,000-block windows and stops there (AL-331). How to deploy again and verify is in `al-core/README.md`, "On Polygon Amoy".

**Checked on 23 November:** al-core, run on the laptop against the emulators and Amoy, minted the seeded `app-approved` (token 1, [mint transaction](https://amoy.polygonscan.com/tx/0x6469aa6e955908253ab4e715052c1d49623031ba9db583501cdf07ba32180664)) and wrote its audit hash ([registry transaction](https://amoy.polygonscan.com/tx/0x97656fa2799e2858967085e9f75fd2f634852adfad6f730043e1eaef0aa282c7)). A second mint call found the same note and sent nothing, and the audit pack's hash matched the registry's. The same from the API on AWS waits for al-core's first deploy there.

## Open decisions

- Local dev: whether Docker Compose also wraps Hardhat
