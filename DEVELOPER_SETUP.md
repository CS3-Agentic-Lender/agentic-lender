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

Open `.env` and fill in the keys you need. Everyone uses their **own** keys (Groq, Gemini, testnet wallet). Never commit `.env` and never paste keys into chat, Jira or Discord.

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

Coming soon. We are setting up [betterleaks](https://github.com/betterleaks/betterleaks) so every commit is checked for leaked keys (Jira AL-52). Until then, check your changes before committing and never commit `.env`.

## 6. Your part of the codebase

Setup for each part (Android, React, Flask, Hardhat) will be added to its folder's README as the code arrives.

## How we work

Read the [team guide on Confluence](https://alprojectcs3.atlassian.net/wiki/spaces/AL/pages/720898/Team+guide+how+we+work) once you are set up. It explains the tools, who owns what, how tickets and branches work, and the rules agents follow.

[README.md](README.md) has the same rules in short: the team, the tech stack, Jira labels, and the branch and PR rules.
