# AL (Agentic Lender)

MTU Year 3 group project (2026/27): a prototype mortgage/HELOC origination platform linking retail borrowers, mortgage brokers and bank underwriters. Graded as a product built in 3 three-week sprints, with a demo on 4 Jan 2027.

## Subsystems and owners

| Dir | Subsystem | Stack | Owner |
|---|---|---|---|
| `al-mobile/` | Borrower app, iOS | Swift + SwiftUI, Firebase Auth | Ibrahima |
| `al-web/` | Broker + underwriter portal | React, React Router, Tailwind, Firebase Auth | Nikoloz |
| `al-core/` | Database + blockchain | Firebase (Firestore, Auth), Solidity, Hardhat, Ethers.js / Web3.py | Dumi |
| `al-ai/` | Property valuation ML + agent committee | Python (FastAPI), scikit-learn, CrewAI / AutoGen / LangGraph, Ollama + Groq / Gemini | Nic |
| `docs/` | Sprint docs, use cases, test cases, infra outline | Markdown | All |

Stay inside the subsystem the task is about. A change that touches another owner's directory goes in its own PR so that owner reviews it.

## Tech stack

The stack is fixed by the brief (`PROJECT GUIDELINES/GroupProject-Year3-2026.pdf`, gitignored). Don't swap a listed technology for an alternative (e.g. Supabase for Firebase) without a team decision recorded in `docs/infrastructure.md`.

- **Database + auth:** Firebase: Cloud Firestore and Firebase Auth (email/password + Google). Mobile and web sign in directly; the Python API verifies Firebase ID tokens.
- **Ledger:** Solidity contracts (ERC-721 loan notes, SHA-256 audit registry) on Hardhat locally, Polygon Amoy or Arbitrum Sepolia as the testnet.
- **LLMs:** at least two cloud APIs (Groq, Gemini) plus one local model through Ollama. Only some laptops can run Ollama. On a machine that can't, never replace the Ollama call with a cloud model, mock it or skip it. Instead, add a comment to the Jira ticket that @mentions a teammate who runs Ollama and lists exactly what to run (branch, command, expected result), then wait for their reply on the ticket. The one exception is the app deployed on AWS, which uses Amazon Bedrock in place of Ollama (team decision in `docs/infrastructure.md`).
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

The Agile module's epic → user story → task is Jira's Epic → Story → Subtask. Jira's Task type is only for non-feature work.

Label every item with its subsystem: `mobile`, `web`, `core`, `ai`, `docs`. Items tagged `draft-backlog` are the first-pass backlog and still under review.

Assign by subsystem label: `mobile` → Ibrahima (Jira: dosantos2945), `web` → Nikoloz, `core` → Dumi (Jira: solomondunmi1), `ai` → Nic. A story with both a client label (`mobile`/`web`) and a backend label (`core`/`ai`) goes to the client owner, and its backend work gets its own Subtask assigned to the backend owner.

Nic and Dumi keep their backend ticket counts roughly even, so some `core` tickets are assigned to Nic and some `ai` tickets to Dumi. Either of them can pass a ticket to the other: reassign it in Jira and add a comment saying why, so the history shows who did what.

### Creating a ticket

Each of us is interviewed on our own tickets, so a Story or Subtask is understood by its owner before it exists.

1. **Grill first.** Run the `grilling` skill with the person the ticket is for. Done when they can state, in their own words:
   - the user story: "As a … I want … so that …"
   - numbered acceptance criteria that a reviewer can check
   - where it sits: the parent Epic (for a Story) or parent Story (for a Subtask), its subsystem label and its owner
   - for a Story, a story-point suggestion (below)
2. **Draft it in their words**, under the headings `## User story`, `## Spec` (only when fields, rules or values need pinning down) and `## Acceptance criteria`.
3. **Create it once they confirm the draft.** It goes into the active sprint only when the team has agreed to pull it in; otherwise it waits in the backlog for sprint planning.

Tasks and Bugs skip the grilling, but still get a subsystem label, an owner and acceptance criteria.

**Story points** size a Story against the others; they are not hours. Scale: 1, 2, 3, 5, 8, 13. The creator suggests a number during grilling and the team agrees it at sprint planning (planning poker). A Story at 13 or more is split before it enters a sprint. Subtasks carry no points. Estimating starts at the next sprint planning session.

## Sprint discipline

The project is graded sprint by sprint, and each of us is interviewed on what we personally did. Work therefore happens **in the sprint it belongs to**, on **the tickets that person was assigned**. Building a later sprint's features early is not "getting ahead": it empties the next sprint, breaks the sprint report, and leaves teammates waiting on work that was skipped.

### Sprint cycle

1. **Estimate:** every Story in the backlog gets story points (see [Creating a ticket](#creating-a-ticket)).
2. **Plan:** the team sets a sprint goal, pulls in the Stories that fit (from the second sprint on, sized by the points finished last sprint, the velocity), and breaks each Story into Subtasks with owners.
3. **Start:** starting the sprint in Jira starts its burndown chart, built from the points of the Stories in it.
4. **Run:** daily standups; tickets move To Do → In Progress → In Review → Done through the branch and PR flow.
5. **Review:** demo what is Done to the supervisor. Unfinished Stories go back to the backlog.
6. **Retro:** what went well, what went wrong, what changes. Actions become tickets for the next sprint.

**Burndown chart.** The chart only falls when a whole Story reaches Done, so it stays honest only if:

- every Story in the sprint has points before the sprint starts;
- a Story added mid-sprint has the team's agreement and a comment on it saying why, since the chart shows it as a rise;
- Jira status matches reality, which the branch and PR flows keep true.

At the end of the sprint, the burndown chart and the list of finished and unfinished Stories go on the retro page, and the retro works from them.

### Check before writing any code

An agent asked to build something runs these three checks first, in order, and **stops** if any of them fails:

1. **A ticket exists**, and `getJiraIssue` returns it.
2. **The ticket is in the active sprint.** Check the `Sprint` field, or `searchJiraIssuesUsingJql` with `key = AL-<number> AND sprint in openSprints()`.
3. **The ticket is assigned to the person asking.** Check `assignee` against `atlassianUserInfo`.

If a check fails, say which one, and offer the legitimate routes: pick a ticket from the active sprint instead, ask the team to pull the ticket into the sprint, or take the ticket over in Jira first. Do not start the work and sort the ticket out afterwards.

### While working

- **One ticket per branch and per PR.** Don't add "while I was in there" changes for other tickets; open a new ticket instead.
- **Work found mid-ticket** that is outside its scope becomes a new Jira ticket with `needs-triage`. It is not quietly built.
- **Out-of-sprint requests**, however small or however framed (a quick screen, scaffolding, a placeholder, groundwork for next sprint), get the same answer: it goes into a ticket, the team pulls it into a sprint, then it gets built.
- **Don't edit someone else's subsystem to unblock yourself.** Integration work that genuinely needs a change in another owner's directory is allowed, but it is agreed first: comment on their ticket, get their agreement, then do it on its own ticket in its own PR, which `CODEOWNERS` sends to them to review. What is not allowed is quietly changing their code inside your own ticket.

### Done in Jira, and finished for the sprint

Merging the PR moves the ticket to Done automatically. That flag means the code landed; it does not mean the work is finished for marking.

A ticket counts as finished for the sprint when all three hold:

1. Its PR is merged into `main`.
2. Its acceptance criteria are met, not just "the code runs".
3. It is covered by the writer's sprint document in Confluence (see below), before the sprint ends.

So a Done ticket with no write-up is not an error in Jira, it is work that will not be visible in the sprint report or the interview. Catch these in the sprint review, not by fighting the automation.

## Sprint documentation (Confluence)

Every sprint leaves written evidence, in one fixed place, because the sprint report and the individual interview are marked off it.

### Structure

Confluence space `AL`, one folder per person, one folder per sprint inside it, documents inside that:

```
AL space
├── Nic
│   ├── Week 3 deliverables - Nic
│   │   ├── Week 3 deliverables summary - Nic
│   │   └── (supporting pages: diagrams, model results, decisions)
│   └── Sprint 1 - <sprint name> - Nic
│       └── ...
├── Dumi
├── Nikoloz
└── Ibrahima
```

Rules:

- **Person folder name = the person's first name**, nothing else.
- **Sprint folder name = `<sprint name exactly as it is in Jira> - <Name>`.** Copy the Jira sprint name rather than inventing a number: the brief treats the Week 3 deliverables (10%) as separate from the three three-week sprints that run weeks 3 to 11 (50%), so "Sprint 1" means the first of those three, not the current Week 3 work. The name on the end is not decoration: Confluence rejects two folders with the same title in one space.
- Everything you produce in a sprint goes inside that sprint's folder: diagrams, UI flows, Figma links, screenshots, test evidence, decisions. Nothing loose at the top of the space, and nothing left only in Figma or a chat.

### The sprint summary page

One per person per sprint, named `<sprint name> summary - <Name>`, written as you go rather than the night before the deadline. It holds:

- **Tickets finished**, by key and title, each linking to its Jira ticket and merged PR.
- **What was actually built**, in your own words, with screenshots or diagrams where a picture is clearer.
- **Evidence it works**: test results, a screen recording, the emulator or testnet output.
- **What did not get finished** and why, with the ticket it moved to.
- **Anything a marker would ask you to explain**, such as why an approach was chosen.

Write it yourself. An agent may format it, add diagrams or tidy the wording, but the account of what you did and why is yours: you are interviewed on it, and 25% of the grade rides on that interview.

## Agent skills

### Skill folders

Claude Code loads skills from `.claude/skills/`; Codex and other agents load them from `.agents/skills/`. The real files live in `.agents/skills/<name>/`, and `.claude/skills/<name>` is a relative symlink to it (`ln -s ../../.agents/skills/<name> .claude/skills/<name>`). When you add, remove or rename a skill, do it in both folders so they always list the same skills.

### UI work

For any screen or component, on web or mobile, load `ui-ux-pro-max` first. It is the single source for design tokens (colour, type, spacing), so the portal and the mobile app look like one product. [21st.dev](https://21st.dev) React + Tailwind components are an optional extra for `al-web`; restyle them with the shared tokens.

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

The PR **description** counts too: GitHub for Atlassian links a ticket to a PR from any `AL-` key it finds there, and the flow then transitions that ticket on merge. This already closed AL-53 by accident because PR #2 named it as the next ticket.

So the branch name, every commit message, the PR title and the PR body together carry **exactly one** key: the ticket being worked on. Anywhere else, name the other ticket in words ("the Firebase emulator setup"), never as `AL-53`, and link the two tickets in Jira instead.

Work on a Subtask uses the **Subtask's** key, not its parent Story's.

### Before starting

1. Get the ticket key from the user, or find it in Jira. No ticket, no work: stop and ask which ticket to use, or create one (see [Creating a ticket](#creating-a-ticket) and `docs/agents/issue-tracker.md`). Never invent a key.
2. Read the ticket with `getJiraIssue` to confirm the key exists and matches the work. A key that 404s is the wrong key.
3. Branch from up-to-date `main`: `git fetch origin && git switch -c <branch> origin/main`.

Creating that branch moves the ticket to In Progress, and opening a PR moves it to In Review, so both happen when the work really starts and really ends. Don't create branches for tickets you are not about to work on, and don't open a PR to park unfinished work.

### Formats

| Thing | Format | Example |
|---|---|---|
| Branch | `feature/AL-<number>-short-description`, lowercase, hyphens, no other key | `feature/AL-54-firebase-auth` |
| Commit subject | `AL-<number> <imperative summary>`, lowercase after the key, no full stop | `AL-54 add google sign-in provider` |
| PR title | `AL-<number> <Sentence case summary>` | `AL-54 Add Google sign-in provider` |

A commit that fixes a review comment keeps the same key; never renumber mid-branch. `chore/`, `fix/` and bare branch names are not used: every branch is `feature/AL-…`, whatever the work type.

### Opening the PR

**The person opens the PR, not the agent.** Committing and pushing a feature branch is normal agent work. Opening the pull request is not: a PR asks a named teammate to spend their time reviewing, and puts that person's name on the work.

An agent therefore **never** runs `gh pr create`, opens a PR through the API, marks a draft ready for review, merges, approves, or resolves someone's review comment, unless the user has asked for that in the current conversation. "Finish the ticket" is not that request.

Before asking, the agent checks its own work against the rules above and says so in one line each:

- [ ] Branch, every commit message, and the PR title it is proposing carry **one** key, the ticket's own, and nothing else carries a key.
- [ ] Commit subjects match the format table, and each commit is one person's work on this ticket.
- [ ] The diff stays inside the ticket's scope and inside this owner's subsystem.
- [ ] `betterleaks` is clean, and the project's build and tests were actually run, with their output shown.

A failed check is fixed before the question, not mentioned as a caveat after it.

When the branch looks finished, the agent stops and reports:

- what is on the branch, file by file;
- the evidence it works: the commands run and their output;
- anything left undone or uncertain;
- then asks whether to open the PR.

If the answer is yes, the agent writes the body with the `pr` skill (what changed, evidence, merge risk, no other ticket's key in it) and opens it against `main`.

Other rules:

- `main` is protected: one approval from a teammate, and the `Secret scan` check green, before merge.
- Never `git push` to `main`, never force-push a shared branch, never `--no-verify`.
- Review comments from a teammate are answered by the person, with the agent's help. An agent does not close a discussion on their behalf.

### One person, one ticket, one commit

Individual contribution is 25% of the grade and is read from the git history. Keep each commit to one person's work on one ticket. If a change belongs to another owner's directory, it goes in its own PR on its own ticket so that owner reviews it.

## Secrets

The repo is public, so a committed key is scraped within minutes.

- Keys live in `.env`, which is gitignored. When you add a key to `.env`, add its name with an empty value to `.env.example`.
- Keys are personal (Groq, Gemini, wallet private keys). Testnet wallets only.
- betterleaks scans every commit (`.githooks/pre-commit`) and every PR (`.github/workflows/secret-scan.yml`). Never bypass it with `--no-verify`. If it flags something, stop and show the user the finding.
