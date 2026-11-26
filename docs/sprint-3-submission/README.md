# Agentic Lender: Sprint 3 submission

MTU Year 3 Group Project 2026/27. Sprint 3 runs from 16 November to 28 November 2026 (Jira "Sprint 3"). Jira task: AL-204.
Team: Ibrahima Toure (iOS borrower app), Nikoloz Chilachava (web portal), Nicholas Groenewald (AI, valuation and AWS deployment, group leader), Solomon Sosanya (database and blockchain).

This folder follows the Sprint 2 zip (`docs/sprint-2-submission/`). Nic puts the final zip together. Status below is as of 23 November.

## Deadlines

| When | What |
|---|---|
| Friday 27 November | Sprint work due (sprint goal) |
| Saturday 28 November | Everyone hands in their wireframes, test cases and retro input to Nic |
| Sunday 29 November, 23:59 | Nic uploads the zip to Canvas (only the group leader submits) |

## What is in this zip

| Folder | What it holds |
|---|---|
| `sprint-backlog/` | `Jira.csv`: the 65 issues in Sprint 3 including subtasks (key, type, summary, status, assignee, priority, story points, parent, labels, dates). Exported 23 Nov; re-export on the last day |
| `nic/`, `nikoloz/`, `ibrahima/`, `dumi/` | One folder per team member. The **use case** for each Epic is a PDF at the top of the owner's folder. Each **Story** has its own folder named by its Jira key, with `wireframe.png`, `test-case.pdf` and `implementation.pdf`. Stories with no screen use a flow diagram as the wireframe |
| `retrospective/` | The Sprint 3 retrospective and review, as a short Word document |
| `code/` | The code on `main` at the end of the sprint (`git archive`, then a secret scan). Nic does this last |

## Acceptance criteria (AL-204) and what is in

| # | Criterion | State on 23 Nov |
|---|---|---|
| 1 | Sprint backlog: an export of the Sprint 3 board | [x] `sprint-backlog/Jira.csv` exported. [ ] Re-export after the last merge (Sat 28 or Sun 29 Nov) |
| 2 | A use case for each feature (epic) in the sprint | [x] AL-7 (Nic, Sprint 3 update drafted: `nic/AL-7-ai-credit-committee.md`). [x] AL-15 (Nic, new, drafted: `nic/AL-15-project-infrastructure.md`). [ ] AL-4, AL-10, AL-11 (Nikoloz). [ ] AL-12, AL-13, AL-194 (Ibrahima). [ ] AL-336 Administration (Nic, new). [ ] AL-333, AL-347, AL-348, AL-349 have no Epic yet. Nic's two drafts still need his check and a PDF export |
| 3 | A wireframe and a test case for every Sprint 3 story, plus a design where it helps | [ ] 6 stories from Ibrahima, 5 from Nikoloz (table below). Nic owns one Sprint 3 Story, AL-337 (`nic/AL-337/`); his Tasks have test cases drafted in `nic/AL-223/` and `nic/AL-180/`, with the design `nic/AL-15-aws-architecture.png` |
| 4 | The sprint retrospective/review as a short Word document | [ ] Not started. AL-174 is Nikoloz's; everyone's input due Sat 28 Nov |
| 5 | The code from `main` at the end of the sprint | [ ] Not yet, by design: export after the last merge (`code/TODO.md`) |
| 6 | Nic uploads it to Canvas by 23:59 on Sun 29 Nov | [ ] Nic |

## What the submission asks for

| Asked for | Where it is |
|---|---|
| Sprint deliverable (viable working product, as agreed in the sprint backlog) | `code/` (the code on `main` at the end of the sprint). Also live at `https://agentic-lender.com` |
| Sprint backlog outlining the features to be implemented | `sprint-backlog/Jira.csv` |
| Use case for each feature (an Epic, made of several stories) | One PDF per Epic at the top of the owner's folder |
| For each story: wireframe | `<person>/<story>/wireframe.png` |
| For each story: test case | `<person>/<story>/test-case.pdf` |
| For each story: design, if appropriate | `<person>/<story>/design.png` or `design.pdf` |
| For each story: implementation | `<person>/<story>/implementation.pdf` (merged PR links) plus the code in `code/` |
| Sprint retrospective and review | `retrospective/` |

## Stories in Sprint 3 (wireframe and test case each)

| Story | Owner | Epic | Points | Jira status on 23 Nov | Folder |
|---|---|---|---|---|---|
| AL-30 As an underwriter, I read each agent's reasoning trail and the committee's consensus | Nikoloz | AL-7 AI Credit Committee | 3 | In Progress | `nikoloz/AL-30/` (also in Sprint 2) |
| AL-40 As an underwriter, I apply a +100 to +300 bps rate shock and see how the portfolio holds up | Nikoloz | AL-10 Stress-Testing Simulator | 5 | To Do | `nikoloz/AL-40/` |
| AL-41 As an underwriter, I simulate a house price downturn and see the change in portfolio LTVs | Nikoloz | AL-10 Stress-Testing Simulator | 3 | To Do | `nikoloz/AL-41/` |
| AL-44 As a borrower, I pay a fast-track appraisal fee through Stripe Sandbox | Ibrahima | AL-12 Payments | 8 | Done | `ibrahima/AL-44/` |
| AL-45 As a borrower, I submit a support request from the app | Ibrahima | AL-13 Support & Reviews | 3 | Done | `ibrahima/AL-45/` |
| AL-46 As a borrower, I rate and review the app | Ibrahima | AL-13 Support & Reviews | 2 | Done | `ibrahima/AL-46/` |
| AL-196 As an underwriter, I review a HELOC application with its combined LTV and collateral value | Nikoloz | AL-194 HELOC | 5 | In Progress | `nikoloz/AL-196/` (also in Sprint 2) |
| AL-310 iOS: show who sent each message when the lending officer replies | Ibrahima | AL-11 Messaging | 2 | Done | `ibrahima/AL-310/` |
| AL-311 As a borrower, I'm told to verify my email after sign-up and can resend the link | Ibrahima | AL-4 Accounts & Roles | none | Done | `ibrahima/AL-311/` |
| AL-313 As a borrower, I move around the app with a tab bar (Home, Property, Messages, Profile) | Ibrahima | AL-4 Accounts & Roles | none | Done | `ibrahima/AL-313/` |
| AL-333 As an underwriter, I read a loan file whose committee and loan note are shown as clear 3D views of the stored data | Nikoloz | none set | none | In Review | `nikoloz/AL-333/` |
| AL-337 As an admin, I manage staff accounts and handle the app's reviews and support requests | Nic | AL-336 Administration | none | Done (added 24 Nov) | `nic/AL-337/` |
| AL-347 As an underwriter or broker, I land on an Overview that shows my work queue and key figures | Nikoloz | none set | 8 | Done (added after 23 Nov) | `nikoloz/AL-347/` |
| AL-348 As an underwriter, I run the rate shock on a redesigned page with a 3D view of the portfolio | Nikoloz | none set | 5 | Done (added after 23 Nov) | `nikoloz/AL-348/` |
| AL-349 As an underwriter, I read a tighter loan file with no empty boxes and the affordability figures shown | Nikoloz | none set | 3 | Done (added after 23 Nov) | `nikoloz/AL-349/` |

AL-311, AL-313, AL-333 and AL-337 have no story points in Jira. AL-333, AL-347, AL-348 and AL-349 have no parent Epic.

## Nic's Sprint 3 tickets (Tasks, not Stories)

| Ticket | Title | Jira status 23 Nov | Test case |
|---|---|---|---|
| AL-223 | Set up the shared AWS infrastructure with Terraform (subtasks AL-224, 225, 226, 227, 228, 326, 328: all Done) | In Progress (criterion 6 left) | `nic/AL-223/test-case.md` |
| AL-180 | Deploy the al-ai service to AWS (subtasks AL-229, 230 Done; AL-231 In Review) | In Progress (waits on PR #275) | `nic/AL-180/test-case.md` |
| AL-129 | Amazon Bedrock variant for the deployed affordability agent | Done | covered in `nic/AL-180/test-case.md` (TC-180-03, TC-231-01) |
| AL-327 | Bug: a committee run interrupted mid-way stays "running" for ever | Done | none drafted |
| AL-204 | Sprint 3 submission | In Progress | n/a |

Evidence screenshots and logs: `nic/evidence/`. Facts for Nic's Confluence summary: `nic/sprint-3-summary-facts.md`.

## Use cases (one per Epic)

Same ownership rule as Sprint 2: whoever wrote its Sprint 2 use case, then its Sprint 1 use case, then whoever owns most of the Epic's Sprint 3 stories.

| Epic | Feature | Owner | File |
|---|---|---|---|
| AL-4 | Accounts & Roles | Nikoloz | update `docs/sprint-2-submission/nikoloz/AL-4-accounts-and-roles.pdf` for AL-311, AL-313 |
| AL-7 | AI Credit Committee | Nic | drafted: `nic/AL-7-ai-credit-committee.md` (Sprint 3 update); Nic checks, exports PDF |
| AL-10 | Stress-Testing Simulator | Nikoloz | NEW: write a use case |
| AL-11 | Messaging | Nikoloz | reuse or update `docs/sprint-2-submission/nikoloz/AL-11-messaging.pdf` |
| AL-12 | Payments | Ibrahima | NEW: write a use case |
| AL-13 | Support & Reviews | Ibrahima | NEW: write a use case |
| AL-336 | Administration | Nic | NEW: write a use case (AL-337) |
| AL-15 | Project Infrastructure (the AWS deployment) | Nic | drafted: `nic/AL-15-project-infrastructure.md`; Nic checks, exports PDF |
| AL-194 | Home equity line of credit (HELOC) | Ibrahima | reuse or update `docs/sprint-2-submission/ibrahima/AL-194-heloc.pdf` |

## Still owed, by person (due Sat 28 Nov)

**Ibrahima** (`ibrahima/TODO.md`)
- Wireframe, test case and implementation for AL-44, AL-45, AL-46, AL-310, AL-311, AL-313.
- Use cases: AL-12 Payments (new), AL-13 Support & Reviews (new), AL-194 HELOC (reuse or update).
- Retro input.

**Nikoloz** (`nikoloz/TODO.md`)
- Wireframe, test case and implementation for AL-30, AL-40, AL-41, AL-196, AL-333, AL-347, AL-348, AL-349 (AL-30 and AL-196 can reuse their Sprint 2 files if unchanged).
- Use cases: AL-10 Stress-Testing Simulator (new), AL-4 Accounts & Roles (update), AL-11 Messaging (reuse or update).
- Set a parent Epic on AL-333, AL-347, AL-348 and AL-349.
- AL-174 Sprint 3 retrospective (his ticket) plus his own retro input.

**Dumi** (`dumi/TODO.md`)
- Retro input.
- Backend steps for the test cases of AL-40, AL-41, AL-44, AL-45, AL-46 if Nikoloz or Ibrahima ask. No Story or use case of his own this sprint.

**Nic** (`nic/`)
- Check and reword the drafts: `AL-223/test-case.md`, `AL-180/test-case.md`, `AL-7-ai-credit-committee.md`, `AL-15-project-infrastructure.md`, and the "What was built" lines now drafted in both `implementation.md` files; export all to PDF.
- Read and rewrite `nic/sprint-3-summary-DRAFT.md` in your own words (settle the four **[check]** lines), then post it to Confluence as "Sprint 3 summary - Nic" in "Sprint 3 - Nic", uploading the six cropped screenshots and the logs from `nic/evidence/` (AL-231 criterion 3).
- Optionally add AL-224's two Jira screenshots to `nic/evidence/`. The six screenshots are cropped (originals in `nic/evidence/originals/`).
- Get PR #275 reviewed and merged (AL-231 and AL-180 criterion), then `./deploy/al down` at the end of the sprint (AL-223 criterion 6, AL-231 criterion 4).
- Retro input; re-export `Jira.csv`; export `code/`; zip; upload by 23:59 Sun 29 Nov.
