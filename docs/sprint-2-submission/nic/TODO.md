# Nic: Sprint 2 to-do

Hand in to Nic by **Saturday 14 November**. Nic uploads to Canvas by Sunday 15 November 23:59.

## 1. For each of your stories: wireframe, test case, design (if appropriate) and implementation

| Story | Title | Jira status | Folder |
|---|---|---|---|
| AL-26 | As an underwriter, a valuation agent flags overvalued collateral and computes LTV | Done | `AL-26/` |
| AL-27 | As an underwriter, a market research agent pulls current central bank rates and mortgage trends | To Do | `AL-27/` |
| AL-28 | As an underwriter, a strategist agent decides Approve / Conditionally Approve / Decline and writes a credit memo | Done | `AL-28/` |
| AL-29 | As a developer, the agents run on two cloud LLM APIs plus a local Ollama model | In Review | `AL-29/` |
| AL-130 | As an underwriter, the credit committee runs end to end on each application and saves one run record | To Do | `AL-130/` |
| AL-131 | As a data scientist, the valuation endpoint returns how much each house feature added to or took off the estimate | Done | `AL-131/` |

## 2. The use cases you own

Each Epic has one use case and one owner (see the use case table in `../README.md`). Write only the ones below, saved as a PDF at the top of your folder. For any other Epic your stories belong to, the owner in the README covers it: don't write your own.

| Epic | Feature | File | What to do |
|---|---|---|---|
| AL-6 | Fair-Price Property Checker | `Nicholas/AL-6-fair-price-property-checker.pdf` (in the Sprint 1 zip) | reuse or update |
| AL-7 | AI Credit Committee | `nic/AL-7-ai-credit-committee.pdf` | done |

## 3. Check before you hand in

- [ ] Every story above has `wireframe.png` and `test-case.pdf`, named exactly like that, a `design` file where one makes sense, and an `implementation.md` linking the merged PRs.
- [ ] Every Epic in section 2 has a use case PDF.
- [ ] The Jira status of your stories matches the real state (a Story is Done only when its acceptance criteria are met).
- [ ] Your part of the retrospective and review is written (see `retrospective/`).
- [ ] The work you did is in a working state on `main` (the sprint deliverable is a viable working product as agreed in the sprint backlog).
