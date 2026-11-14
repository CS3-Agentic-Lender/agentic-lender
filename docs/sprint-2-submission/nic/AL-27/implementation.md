# AL-27: As an underwriter, a market research agent pulls current central bank rates and mortgage trends

## What was built

Dumi built the ECB rate tool, which gets the two rates and caches them in Firestore, and the `ai_calls` logging. I built the market agent and the wiring. The agent does two Serper searches and sees only the official figures and those results, on Gemini. The code checks every link, date and number in its reply. I also made the committee read both rates from Dumi's tool, so a missing rate, or an old cached one when the ECB is down, stops the run before any model is called. The day's report is reused unless the figures change, and the listener shares it across its runs.

## Pull requests

| PR | Title | Merged | By |
|---|---|---|---|
| [#135](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/135) | AL-125 Add the market and macro agent step with Serper search | 2026-10-29 | Nic |
| [#179](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/179) | AL-291 Take the committee and affordability rates from the ECB rate tool | 2026-11-08 | Nic |
| [#202](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/202) | AL-307 Share one market report store across the listener's runs | 2026-11-12 | Nic |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#171](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/171) | AL-124 Add the ECB rate tool with a Firestore cache | 2026-11-06 | Dumi |
| [#177](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/177) | AL-140 Save every AI call as an ai_calls document | 2026-11-10 | Dumi |
