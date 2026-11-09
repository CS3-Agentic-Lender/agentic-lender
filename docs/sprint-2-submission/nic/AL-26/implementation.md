# AL-26: As an underwriter, a valuation agent flags overvalued collateral and computes LTV

## What was built

I built the valuation checks in code first, so the price gap, the "price needs review" flag and both LTVs never come from the LLM. The agent only gets those results to explain, so it can't make up a figure or recommend Approve over a flag the code set. It runs on Groq gpt-oss-120b instead of Mistral (no free API), with Gemini Flash-Lite as the backup a person switches to by hand.

## Pull requests

| PR | Title | Merged | By |
|---|---|---|---|
| [#105](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/105) | AL-122 Add the valuation checks | 2026-10-27 | Nic |
| [#115](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/115) | AL-123 Add the valuation agent step | 2026-10-29 | Nic |
| [#124](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/124) | AL-123 Record the Groq decision and make Gemini Flash-Lite the backup | 2026-10-29 | Nic |
