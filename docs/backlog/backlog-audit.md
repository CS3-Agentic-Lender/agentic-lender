# Backlog audit

Snapshot of the Jira space `AL` on 29 Sep 2026: all 111 items, AL-4 to AL-114. It records the backlog as it was before any refinement, so later changes can be compared against it.

The standard is the brief (`GroupProject-Year3-2026.pdf`) and the two MTU guideline documents (`3rd year Project Guidelines 2026.pdf`, `3rd year Project Report and Deliverables 2026.pdf`), all in `docs/PROJECT GUIDELINES/`.

## Totals

| | Epics | Stories | Tasks | Subtasks | All |
|---|---|---|---|---|---|
| Items | 12 | 32 | 21 | 46 | 111 |
| Written as "As a…, I want…, so that…" | n/a | 0 | n/a | n/a | 0 |
| Have a description beyond a one-line pointer | 12 (one line) | 4 | 18 | 26 | 60 |
| Have at least one acceptance criterion | 0 | 0 | 15 | 23 | 38 |
| Have 3 or more acceptance criteria | 0 | 0 | 4 | 0 | 4 |
| Priority other than the default (Medium) | 0 | 0 | 0 | 0 | 0 |
| Story points set | 0 | 0 | 0 | 0 | 0 |
| No subsystem label | 1 | 1 | 0 | 0 | 2 |
| No assignee | 12 | 1 | 1 | 0 | 14 |
| In a sprint | 0 | 0 | 16 | 11 | 27 |
| Issue links to other items | 0 | 0 | 0 | 0 | 0 |

The only sprint is **Week 3 deliverables** (open). No Sprint 1–3 exists yet, so no story is scheduled.

## After the review (29 Sep 2026)

The tables below are the backlog **before** refinement. What changed afterwards:

- Every open item has a user story, at least three acceptance criteria (epics: three "done when" checks) and a MoSCoW priority mapped to Jira (Must = Highest, Should = High, Could = Medium, Won't = Low). Exception: AL-101, labelled `blocked`. Done items were not touched.
- One lifecycle status list everywhere: Draft, Applied, AI Deliberated, Underwriter Approved, Declined, Funded, Closed.
- AL-19: LTV cap corrected to 90% for all buyers; the calculator uses the ECB benchmark rate. Take-home pay and living costs added to the application form.
- Custom feature chosen: explain the valuation (AL-14, AL-47; stories AL-131 to AL-133).
- Splits: AL-51 into AL-51/AL-173/AL-174; AL-87 into AL-87/AL-168; AL-16 into AL-16/AL-142 (AL-95 moved); AL-37 into AL-37/AL-151.
- New gap tickets (`needs-triage`): AL-130 committee orchestration, AL-129 Bedrock variant, AL-152 lending-officer replies, AL-175 test phase, AL-176 final documentation, AL-177 demo, AL-178 HELOC decision, AL-179 iOS confirmation, AL-180 to AL-184 deployment.
- New subtasks for every story that lacked a client or backend piece: AL-115 to AL-128, AL-134 to AL-141, AL-143 to AL-150, AL-153 to AL-167, AL-169 to AL-172.

## Legend

- **Story**: *Partial* = the title reads "As a [role], I [action]" but there is no goal ("so that…") and no body; *No* = not a user story (e.g. "As the team…", a placeholder); *n/a* = epic, task or subtask, where a user story isn't expected.
- **Description**: *None* = empty; *Pointer* = one line that only restates the title or names the parent ("Backend piece of AL-16"); *Summary* = one-line feature summary; *Decisions* = a list of design decisions, no story and no criteria; *Brief* = a proper task brief (scope, options, done-when); *Spec* = detailed fields and rules.
- **AC**: number of acceptance criteria or "Done when" conditions written on the ticket. **Testable**: can someone who wasn't in the conversation check each one and get a yes or no.
- **Sprint**: *W3* = Week 3 deliverables; — = none. Subtasks inherit their parent's sprint in Jira.
- **Pri** is Medium on every item, which is Jira's default, so it is shown once here and not per row. **Points** are empty on every item.
- Assignees by first name; Dumi appears in Jira as "Solomon".

## Epics

| Key | Summary | Status | Story | Description | AC | Testable | Labels | Assignee | Children |
|---|---|---|---|---|---|---|---|---|---|
| AL-4 | Accounts & Roles | To Do | n/a | Summary | 0 | — | core, mobile, web | none | 3 stories |
| AL-5 | Loan Application | To Do | n/a | Summary | 0 | — | ai, core, mobile | none | 3 stories |
| AL-6 | Fair-Price Property Checker | To Do | n/a | Summary | 0 | — | ai, mobile, web | none | 3 stories |
| AL-7 | AI Credit Committee | To Do | n/a | Summary | 0 | — | ai, mobile, web | none | 7 stories |
| AL-8 | Origination Pipeline | To Do | n/a | Summary | 0 | — | core, web | none | 3 stories |
| AL-9 | On-Chain Settlement | To Do | n/a | Summary | 0 | — | core, mobile, web | none | 5 stories |
| AL-10 | Stress-Testing Simulator | To Do | n/a | Summary | 0 | — | ai, web | none | 2 stories |
| AL-11 | Messaging | To Do | n/a | Summary | 0 | — | core, mobile, web | none | 2 stories |
| AL-12 | Payments | To Do | n/a | Summary | 0 | — | core, mobile | none | 1 story |
| AL-13 | Support & Reviews | To Do | n/a | Summary | 0 | — | core, mobile | none | 2 stories |
| AL-14 | Custom Feature (TBD) | To Do | n/a | Summary (options, none chosen) | 0 | — | **none** | none | 1 placeholder |
| AL-15 | Project Infrastructure | To Do | n/a | Summary | 0 | — | docs | none | 20 tasks |

## Stories

Every story is To Do, in no sprint, and still labelled `draft-backlog`.

| Key | Summary | Parent | Story | Description | AC | Testable | Labels | Assignee | Subtasks |
|---|---|---|---|---|---|---|---|---|---|
| AL-16 | Borrower registers / logs in (email or Google) | AL-4 | Partial | Decisions (6) | 0 | — | core, mobile | Ibrahima | 6 (1 backend, 5 iOS) |
| AL-17 | Broker/underwriter log in, see only their role's views | AL-4 | Partial | None | 0 | — | core, web | Nikoloz | 1 (backend) |
| AL-18 | Broker sees only referred clients' files | AL-4 | Partial | None | 0 | — | core, web | Nikoloz | 1 (backend) |
| AL-19 | Borrower sees how much they can borrow | AL-5 | Partial | Decisions (7, one still open) | 0 | — | ai, mobile | Ibrahima | 4 (1 backend, 3 iOS) |
| AL-20 | Borrower submits a loan application | AL-5 | Partial | Decisions (5) | 0 | — | core, mobile | Ibrahima | 4 (1 backend, 3 iOS) |
| AL-21 | Borrower sees application status | AL-5 | Partial | Decisions (5) | 0 | — | core, mobile | Ibrahima | 4 (1 backend, 3 iOS) |
| AL-22 | Borrower enters property specs, gets a fair valuation | AL-6 | Partial | None | 0 | — | ai, mobile | Ibrahima | 1 (backend only) |
| AL-23 | Underwriter compares asking price with model valuation | AL-6 | Partial | None | 0 | — | ai, web | Nikoloz | 1 (backend) |
| AL-24 | Trained valuation model with accuracy reported | AL-6 | No ("As the team") | None | 0 | — | ai | Nic | 0 |
| AL-25 | Affordability agent: surplus, stressed repayments, DTI | AL-7 | Partial | None | 0 | — | ai | Nic | 0 |
| AL-26 | Valuation agent: flags overvaluation, computes LTV | AL-7 | Partial | None | 0 | — | ai | Nic | 0 |
| AL-27 | Market research agent: central bank rates, trends | AL-7 | Partial | None | 0 | — | ai | Nic | 0 |
| AL-28 | Strategist agent: decision and credit memo | AL-7 | Partial | None | 0 | — | ai | Nic | 0 |
| AL-29 | Agents run on two cloud LLMs plus local Ollama | AL-7 | No ("As the team") | None | 0 | — | ai | Nic | 0 |
| AL-30 | Underwriter reads each agent's reasoning and consensus | AL-7 | Partial | None | 0 | — | ai, web | Nikoloz | 1 (backend) |
| AL-31 | Borrower sees estimated LTV, DTI, approval likelihood | AL-7 | Partial | None | 0 | — | ai, mobile | Ibrahima | 1 (backend) |
| AL-32 | Underwriter queue by LTV, risk tier, status | AL-8 | Partial | None | 0 | — | core, web | Nikoloz | 1 (backend) |
| AL-33 | Underwriter opens loan file with DTI breakdown | AL-8 | Partial | None | 0 | — | core, web | Nikoloz | 1 (backend) |
| AL-34 | Application moves Applied → AI Deliberated → Approved → Funded → Closed | AL-8 | Partial (no actor goal) | None | 0 | — | core | Dumi | 0 |
| AL-35 | Approved loan minted as a digital loan note | AL-9 | Partial ("As a bank") | None | 0 | — | core | Dumi | 0 |
| AL-36 | SHA-256 of memo, valuation, approval stored on-chain | AL-9 | Partial ("As an auditor") | None | 0 | — | core | Dumi | 0 |
| AL-37 | Underwriter sign-off triggers the mint | AL-9 | Partial | None | 0 | — | core, web | Nikoloz | 1 (backend) |
| AL-38 | Underwriter downloads a PDF/CSV audit pack | AL-9 | Partial | None | 0 | — | web | Nikoloz | 0 |
| AL-39 | Borrower sees the loan note's on-chain status | AL-9 | Partial | None | 0 | — | core, mobile | Ibrahima | 1 (backend) |
| AL-40 | Bank manager applies a +100 to +300 bps rate shock | AL-10 | Partial | None | 0 | — | ai, web | Nikoloz | 1 (backend) |
| AL-41 | Bank manager simulates a house price downturn | AL-10 | Partial | None | 0 | — | ai, web | Nikoloz | 1 (backend) |
| AL-42 | Borrower messages their broker or lending officer | AL-11 | Partial | None | 0 | — | core, mobile | Ibrahima | 1 (backend) |
| AL-43 | Broker replies from the portal | AL-11 | Partial | None | 0 | — | core, web | Nikoloz | 1 (backend) |
| AL-44 | Borrower pays a fast-track appraisal fee (Stripe) | AL-12 | Partial | None | 0 | — | core, mobile | Ibrahima | 1 (backend) |
| AL-45 | Borrower submits a support request | AL-13 | Partial | None | 0 | — | core, mobile | Ibrahima | 1 (backend) |
| AL-46 | Borrower rates and reviews the app | AL-13 | Partial | None | 0 | — | core, mobile | Ibrahima | 1 (backend) |
| AL-47 | Placeholder: choose the custom feature | AL-14 | No (placeholder) | None | 0 | — | **none** | **none** | 0 |

## Tasks

| Key | Summary | Parent | Status | Sprint | Description | AC | Testable | Labels | Assignee | Subtasks |
|---|---|---|---|---|---|---|---|---|---|---|
| AL-48 | Week 3: infrastructure outline | AL-15 | Done | W3 | Pointer | 0 | — | docs | Nic | 0 |
| AL-49 | Week 3: website mock-up in Figma | AL-15 | Done | W3 | Brief, no done-when | 0 | — | docs, mobile, web | Nikoloz | 2 (both wontfix) |
| AL-50 | CI runs tests on every PR | AL-15 | To Do | W3 | None | 0 | — | core | Nic | 0 |
| AL-51 | Sprint retrospectives (Sprint 1, 2, 3) | AL-15 | To Do | — | None | 0 | — | docs | **none** | 0 |
| AL-52 | Team-wide secret scanning | AL-15 | Done | W3 | Brief | 0 | — | core | Nic | 0 |
| AL-53 | Local Firebase Emulator Suite, seeded | AL-15 | Done | W3 | Brief with AC section | 4 | Yes | core | Dumi | 0 |
| AL-75 | Fix ticket-key rule | AL-15 | Done | W3 | Brief | 0 | — | docs | Nic | 0 |
| AL-76 | CODEOWNERS: Dumi for al-core | AL-15 | Done | W3 | Brief | 1 | Yes | core | Nic | 0 |
| AL-77 | Week 3: product backlog finalised | AL-15 | To Do | W3 | Brief + checklist | 2 | Yes | docs | Nic | 0 |
| AL-80 | Week 3: borrower app wireframes and prototype | AL-15 | In Progress | W3 | Brief | 3 | Yes | mobile | Ibrahima | 9 |
| AL-81 | Week 3: portal Figma prototype | AL-15 | To Do | W3 | Brief | 5 | Partly: "decisions are documented" gives no place; #5 is a scope note, not a check | web | Nikoloz | 0 |
| AL-82 | Scaffold the mobile app | AL-15 | Done | W3 | Brief | 1 | Yes | mobile | Ibrahima | 0 |
| AL-83 | Scaffold the React portal | AL-15 | In Review | W3 | Brief | 1 | Yes | web | Nikoloz | 0 |
| AL-84 | Record the mobile platform as Ibrahima's choice | **none** | Done | W3 | Brief | 2 | Yes | docs, mobile | Nic | 0 |
| AL-85 | Scaffold the FastAPI service | AL-15 | To Do | — | Brief | 2 | Yes | core | Dumi | 0 |
| AL-86 | Record FastAPI and Bedrock decisions | AL-15 | Done | **—** | Brief | 2 | Yes | docs | Nic | 0 |
| AL-87 | Hardhat project and local chain | AL-15 | To Do | — | Brief (mixes Week 3 breakdown with Sprint 1 setup) | 2 | Yes | core | Dumi | 0 |
| AL-88 | Developer setup guide | AL-15 | Done | W3 | Brief | 1 | Yes | docs | Ibrahima | 0 |
| AL-89 | Record the proposed palette | AL-15 | Done | **—** | Brief | 1 | Yes | docs | Nic | 0 |
| AL-90 | Fix the al-core README | AL-15 | To Do | W3 | Brief | 3 | Yes | core | Dumi | 0 |
| AL-114 | Sprint discipline and Confluence rules | AL-15 | Done | W3 | Brief | 2 | Partly: "the team has agreed" gives no record | docs | Nic | 0 |

## Subtasks

| Key | Summary | Parent | Status | Sprint | Description | AC | Testable | Labels | Assignee |
|---|---|---|---|---|---|---|---|---|---|
| AL-54 | Backend: Auth providers, borrower profile on sign-up | AL-16 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-55 | Backend: role claims, checked by the API | AL-17 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-56 | Backend: broker-client assignment and rules | AL-18 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-57 | Backend: affordability endpoint | AL-19 | To Do | — | Pointer | 0 | — | ai | Nic |
| AL-58 | Backend: applications schema, create, rules | AL-20 | To Do | — | Brief (options, no done-when) | 0 | — | core | Dumi |
| AL-59 | Backend: real-time status field | AL-21 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-60 | Backend: /valuation endpoint | AL-22 | To Do | — | Pointer | 0 | — | ai | Nic |
| AL-61 | Backend: store asking price and valuation | AL-23 | To Do | — | Pointer | 0 | — | ai | Nic |
| AL-62 | Backend: persist reasoning trail and consensus | AL-30 | To Do | — | Pointer | 0 | — | ai | Nic |
| AL-63 | Backend: write LTV, DTI, approval likelihood | AL-31 | To Do | — | Pointer | 0 | — | ai | Nic |
| AL-64 | Backend: LTV, risk tier, status fields and indexes | AL-32 | To Do | — | Pointer | 0 | — | core | Nic |
| AL-65 | Backend: DTI breakdown fields | AL-33 | To Do | — | Pointer | 0 | — | core | Nic |
| AL-66 | Backend: sign-off endpoint that mints | AL-37 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-67 | Backend: sync on-chain state to the application | AL-39 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-68 | Backend: rate shock over the portfolio | AL-40 | To Do | — | Pointer | 0 | — | ai | Nic |
| AL-69 | Backend: downturn LTV recalculation | AL-41 | To Do | — | Pointer | 0 | — | ai | Nic |
| AL-70 | Backend: messages collection and rules | AL-42 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-71 | Backend: broker reply rules, unread state | AL-43 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-72 | Backend: Stripe payment intent and webhook | AL-44 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-73 | Backend: support requests collection | AL-45 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-74 | Backend: reviews collection | AL-46 | To Do | — | Pointer | 0 | — | core | Dumi |
| AL-78 | Superseded by AL-80: borrower wireframes | AL-49 | Done (wontfix) | W3 | Brief | 0 | — | mobile | Ibrahima |
| AL-79 | Superseded by AL-81: portal wireframes | AL-49 | Done (wontfix) | W3 | Brief | 0 | — | web | Nikoloz |
| AL-91 | iOS: sign-up screen, profile fields, validation | AL-16 | To Do | — | Spec | 2 | Yes | mobile | Ibrahima |
| AL-92 | iOS: password rules | AL-16 | To Do | — | Spec | 2 | Yes | mobile | Ibrahima |
| AL-93 | iOS: email sign-in, forgot password | AL-16 | To Do | — | Spec | 2 | Yes | mobile | Ibrahima |
| AL-94 | iOS: Continue with Google | AL-16 | To Do | — | Spec | 1 | Yes | mobile | Ibrahima |
| AL-95 | iOS: choose a broker | AL-16 | To Do | — | Spec | 2 | Yes | mobile | Ibrahima |
| AL-96 | iOS: affordability form | AL-19 | To Do | — | Spec | 2 | Yes | mobile | Ibrahima |
| AL-97 | iOS: affordability result | AL-19 | To Do | — | Spec | 1 | Partly: the "agreed sample inputs" aren't written down | mobile | Ibrahima |
| AL-98 | iOS: call the affordability endpoint | AL-19 | To Do | — | Spec | 2 | Yes | mobile | Ibrahima |
| AL-99 | iOS: loan application form | AL-20 | To Do | — | Spec | 2 | Yes | mobile | Ibrahima |
| AL-100 | iOS: review and submit | AL-20 | To Do | — | Spec | 1 | Yes | mobile | Ibrahima |
| AL-101 | iOS: edit a submitted application | AL-20 | To Do | — | Spec | 2 | Yes | mobile | Ibrahima |
| AL-102 | iOS: status timeline | AL-21 | To Do | — | Spec | 1 | Partly: depends on a status list that isn't agreed | mobile | Ibrahima |
| AL-103 | iOS: live status updates | AL-21 | To Do | — | Spec | 1 | Partly: "within a few seconds" has no number | mobile | Ibrahima |
| AL-104 | iOS: application card on home | AL-21 | To Do | — | Spec | 2 | Yes | mobile | Ibrahima |
| AL-105 | Figma: file setup, tokens, components | AL-80 | Done | W3 | Spec | 1 | Yes | mobile | Ibrahima |
| AL-106 | Figma: sign up and sign in | AL-80 | Done | W3 | Spec | 1 | Yes | mobile | Ibrahima |
| AL-107 | Figma: affordability | AL-80 | Done | W3 | Spec | 1 | Yes | mobile | Ibrahima |
| AL-108 | Figma: property check | AL-80 | Done | W3 | Spec | 1 | Yes | mobile | Ibrahima |
| AL-109 | Figma: application and status | AL-80 | Done | W3 | Spec | 2 | Yes | mobile | Ibrahima |
| AL-110 | Figma: messages | AL-80 | Done | W3 | Spec | 1 | Yes | mobile | Ibrahima |
| AL-111 | Figma: appraisal fee payment | AL-80 | Done | W3 | Spec | 1 | Yes | mobile | Ibrahima |
| AL-112 | Figma: support and reviews | AL-80 | Done | W3 | Spec | 1 | Yes | mobile | Ibrahima |
| AL-113 | Figma: link the clickable prototype | AL-80 | Done | W3 | Spec + checklist | 2 | Yes | mobile | Ibrahima |
