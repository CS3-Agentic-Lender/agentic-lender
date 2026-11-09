# AL-27: As an underwriter, a market research agent pulls current central bank rates and mortgage trends

## What was built

Dumi built the ECB rate tool that gets the two rates and caches them in Firestore. I built the market and macro agent and the wiring: it does two Serper searches, sees only the official figures and those results on Gemini and the code checks every link, date and number in its reply. I also made the committee load both rates from Dumi's tool, so a bad rate stops the run before any model is called and the report is reused for the day unless the figures change.

## Pull requests

| PR | Title | Merged | By |
|---|---|---|---|
| [#135](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/135) | AL-125 Add the market and macro agent step with Serper search | 2026-10-29 | Nic |
| [#179](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/179) | AL-291 Take the committee and affordability rates from the ECB rate tool | 2026-11-08 | Nic |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#171](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/171) | AL-124 Add the ECB rate tool with a Firestore cache | 2026-11-06 | Dumi |
| [#177](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/177) | AL-140 Save every AI call as an ai_calls document | not merged yet | Dumi |
