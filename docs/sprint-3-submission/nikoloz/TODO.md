# Nikoloz: Sprint 3 to-do

Hand in to Nic by **Saturday 28 November**. Nic uploads to Canvas by Sunday 29 November 23:59.

## 1. For each of your stories: wireframe, test case, design (if appropriate) and implementation

| Story | Title | Epic | Jira status 23 Nov | Folder |
|---|---|---|---|---|
| AL-30 | As an underwriter, I read each agent's reasoning trail and the committee's consensus | AL-7 AI Credit Committee | In Progress | `AL-30/` (Sprint 2 files exist: reuse or update) |
| AL-40 | As an underwriter, I apply a +100 to +300 bps rate shock and see how the portfolio holds up | AL-10 Stress-Testing Simulator | To Do | `AL-40/` |
| AL-41 | As an underwriter, I simulate a house price downturn and see the change in portfolio LTVs | AL-10 Stress-Testing Simulator | To Do | `AL-41/` |
| AL-196 | As an underwriter, I review a HELOC application with its combined LTV and collateral value | AL-194 HELOC | In Progress | `AL-196/` (Sprint 2 files exist: reuse or update) |
| AL-333 | As an underwriter, I read a loan file whose committee and loan note are shown as clear 3D views of the stored data | none set in Jira | In Review | `AL-333/` |
| AL-347 | As an underwriter or broker, I land on an Overview that shows my work queue and key figures | none set in Jira | Done | `AL-347/` |
| AL-348 | As an underwriter, I run the rate shock on a redesigned page with a 3D view of the portfolio | none set in Jira | Done | `AL-348/` |
| AL-349 | As an underwriter, I read a tighter loan file with no empty boxes and the affordability figures shown | none set in Jira | Done | `AL-349/` |

AL-40 and AL-41 have backend subtasks by Dumi (AL-68, AL-69, both Done). Ask him for the backend steps of their test cases if you need them.

## 2. The use cases you own

| Epic | Feature | What to do |
|---|---|---|
| AL-10 | Stress-Testing Simulator | NEW: write a use case (you own both its stories) |
| AL-4 | Accounts & Roles | Sprint 2 file `docs/sprint-2-submission/nikoloz/AL-4-accounts-and-roles.pdf`: update for AL-311 and AL-313 (Ibrahima's stories: ask him what changed) |
| AL-11 | Messaging | Sprint 2 file `docs/sprint-2-submission/nikoloz/AL-11-messaging.pdf`: reuse or update for AL-310 |

You also own **AL-174 Sprint 3 retrospective** in Jira (To Do). See `../retrospective/TODO.md`.

## 3. Check before you hand in

- [ ] Every story above has `wireframe.png` and `test-case.pdf`, named exactly like that, a `design` file where one makes sense, and an `implementation.pdf` linking the merged PRs.
- [ ] Every Epic in section 2 has a use case PDF.
- [ ] The Jira status of your stories matches the real state (a Story is Done only when its acceptance criteria are met).
- [ ] Your part of the retrospective and review is written (see `retrospective/`).
- [ ] The work you did is in a working state on `main` (the sprint deliverable is a viable working product as agreed in the sprint backlog).
