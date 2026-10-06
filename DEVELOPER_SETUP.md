# Developer Setup

Follow these steps once, in order. Each step says how to check it worked.

> **Want help? Let an AI agent walk you through it.**
> Open Claude Code, Codex or another agent in an empty folder and paste:
>
> *"Help me set up my laptop for this project by following https://github.com/CS3-Agentic-Lender/agentic-lender/blob/main/DEVELOPER_SETUP.md step by step. I'm on [Mac / Windows / Linux]. Run the commands with me, check each step worked before moving on, and stop and explain if something fails."*
>
> Steps 1 (accepting invites) and 4 (logging in to Jira) need you to click things in the browser yourself. The agent can tell you what to click, but you have to do it.

## 1. Accept your invites

You should get two emails:

- **GitHub**: an invite to the `CS3-Agentic-Lender` organisation.
- **Jira**: an invite to `alprojectcs3.atlassian.net`.

Accept both. **Check:** you can open https://github.com/CS3-Agentic-Lender/agentic-lender and https://alprojectcs3.atlassian.net.

## 2. Get the code

You need Git. Check with `git --version`. If it's missing:

- **Mac:** `xcode-select --install`
- **Windows:** `winget install Git.Git`, or the installer from [git-scm.com](https://git-scm.com/downloads)
- **Linux:** `sudo apt install git` (or your distro's package manager)

### Mac or Linux

```bash
git clone https://github.com/CS3-Agentic-Lender/agentic-lender.git
cd agentic-lender
```

### Windows

The AI skills use **symlinks** (shortcuts from one folder to another). Git saves them in the repo, and Mac and Linux recreate them automatically. Windows only does this if you turn two things on first:

1. Open **Settings > System > For developers** and turn on **Developer Mode**.
2. Clone with symlinks enabled:

```bash
git clone -c core.symlinks=true https://github.com/CS3-Agentic-Lender/agentic-lender.git
cd agentic-lender
```

**Check:** open `.claude/skills/tdd/`. You should see a `SKILL.md` file inside. If `tdd` is a small text file instead of a folder, delete the clone and redo the Windows steps.

## 3. Add your keys

```bash
cp .env.example .env
```

You don't need any keys to run the backend locally: the Firebase emulators use the `demo-al` project, so leave the `FIREBASE_*` and `GOOGLE_APPLICATION_CREDENTIALS` lines empty. Fill in a key only when your work needs it:

| Key | Needed for | Where to get it |
|---|---|---|
| `GROQ_API_KEY`, `GEMINI_API_KEY` | The AI engine (`al-ai`) | Your own free Groq and Google AI Studio accounts |
| `OLLAMA_HOST` | The local model, on laptops that run Ollama | Leave the default `http://localhost:11434` |
| `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` | The appraisal fee payment | Your own Stripe account, **test mode** keys only |
| `RPC_URL`, `DEPLOYER_PRIVATE_KEY` | Deploying contracts to the testnet | A testnet RPC provider and a **testnet-only** wallet |

Everyone uses their **own** keys. Never commit `.env` and never paste keys into Slack, Jira or any other chat.

## 4. Set up your AI agent

All agents read `AGENTS.md` for project rules. Skills live in two folders with the same content:

| You use | Your agent reads skills from |
|---|---|
| Claude Code | `.claude/skills/` |
| Codex or another agent | `.agents/skills/` |

### Connect Jira

Skills like `/to-tickets` and `/triage` read and write Jira tickets, so your agent needs the Atlassian connection. It logs in with your own Jira account; no keys needed.

**Claude Code:** the connection is already in the repo (`.mcp.json`).

1. Start Claude Code inside the `agentic-lender` folder.
2. Say yes when it asks to use the `atlassian` server.
3. Type `/mcp`, pick `atlassian`, and log in. A browser window opens: sign in with your Jira account and click **Accept**.

**Codex:**

```bash
codex mcp add atlassian --url https://mcp.atlassian.com/v2/mcp
```

Start Codex. It should open a browser to log in. If it doesn't, run `codex mcp login atlassian`.

**Check (any agent):** ask it *"List the epics in the AL Jira space."* You should see about 12 epics, such as "Accounts & Roles" and "Fair-Price Property Checker".

## 5. Secret scanning

[betterleaks](https://github.com/betterleaks/betterleaks) checks every commit for leaked keys. The repo is public, so this step is required.

**Install it:**

- **Mac:** `brew install betterleaks`
- **Windows:** download `betterleaks_<version>_windows_x64.zip` from the [releases page](https://github.com/betterleaks/betterleaks/releases), unzip it, and add the folder to your `PATH`.
- **Linux:** download `betterleaks_<version>_linux_x64.tar.gz` from the [releases page](https://github.com/betterleaks/betterleaks/releases), then `tar -xzf betterleaks_*_linux_x64.tar.gz betterleaks && sudo mv betterleaks /usr/local/bin/`.

**Turn on the hook** (once, inside the `agentic-lender` folder):

```bash
git config core.hooksPath .githooks
```

**Check:** `betterleaks version` prints a version number, and `git config core.hooksPath` prints `.githooks`.

From now on, `git commit` is blocked if betterleaks finds a secret, or if betterleaks isn't installed. Every PR is also scanned in GitHub Actions, so a skipped hook still gets caught before merge.

If it flags something that isn't a secret, ask in the team chat before working around it.

## 6. Install the local dev tools

The whole app runs on your laptop with no cloud accounts. The Firebase emulators need Node.js 22+, Java 21+ and the Firebase CLI.

| | Mac | Windows | Linux |
|---|---|---|---|
| Node.js 22+ | `brew install node` | `winget install OpenJS.NodeJS.LTS` | [nodejs.org](https://nodejs.org/en/download) or `nvm install 22` |
| Java 21+ | `brew install --cask temurin@21` | `winget install EclipseAdoptium.Temurin.21.JDK` | `sudo apt install openjdk-21-jdk` |

Mac commands use [Homebrew](https://brew.sh). Node 22 and 24 are the tested versions; newer ones work but `npm` prints `EBADENGINE` warnings, which are safe to ignore. Open a new terminal after installing, then:

```bash
npm install -g firebase-tools
```

**Check:** `node -v` prints v22 or later, `java -version` prints 21 or later, and `firebase --version` prints a version number.

## 7. Run the backend locally

From the `agentic-lender` folder:

```bash
cd al-core
firebase emulators:start --project demo-al --import=./seed-data
```

Leave it running; stop it with Ctrl+C. The `demo-` prefix means no real Firebase project or login is needed.

| Service | Address |
|---|---|
| Emulator UI | http://127.0.0.1:4000 |
| Auth emulator | `localhost:9099` |
| Firestore emulator | `localhost:8080` |

The seed data has one user per role, all with the password `password123`:

| Email | Role |
|---|---|
| alice@test.com | borrower |
| bob@test.com | broker |
| uma@test.com | underwriter |

**Check:** open http://127.0.0.1:4000, go to **Authentication**, and you see the three users above.

Re-seeding and the security rules tests are in [al-core/README.md](al-core/README.md).

## 8. Your part of the codebase

Each part's own README covers opening, running and testing it against the local backend.

| Part | Setup |
|---|---|
| Borrower app (iOS) | [al-mobile/README.md](al-mobile/README.md). Needs a Mac with Xcode 16 or later |
| Database + blockchain | [al-core/README.md](al-core/README.md) |
| Broker and underwriter portal (React) | Added to `al-web/README.md` when the code arrives |
| AI engine (FastAPI) | Added to `al-ai/README.md` when the code arrives |

## How we work

Read the [team guide on Confluence](https://alprojectcs3.atlassian.net/wiki/spaces/AL/pages/720898/Team+guide+how+we+work) once you are set up. It explains the tools, who owns what, how tickets and branches work, and the rules agents follow.

[README.md](README.md) has the same rules in short: the team, the tech stack, Jira labels, and the branch and PR rules.
