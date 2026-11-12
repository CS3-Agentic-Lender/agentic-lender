# AL-30: As an underwriter, I read each agent's reasoning trail and the committee's consensus

## What was built

A Committee section in the loan file that reads the latest stored committee run: the three votes side by side (rating, concerns, conditions, report, provider, model), Market & Macro without a vote, a disagreement marker, the credit memo, the original and effective recommendation, the policy gate, and a "View calls" list of the logged AI calls. A failed run shows its step and reason; Re-run is shown disabled because the re-run endpoint is not built in al-ai yet.

## Pull requests: web portal

| PR | Title | Merged | By |
|---|---|---|---|
| [#195](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/195) | AL-156 Add the committee deliberation console to the loan file | open, approved | Nikoloz |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#197](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/197) | AL-62 Save each agent's report and vote and the consensus on the run | 2026-11-12 | Nic |
| [#177](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/177) | AL-140 Save every AI call as an ai_calls document | 2026-11-10 | Dumi |
