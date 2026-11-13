# AL-29: As a developer, the agents run on two cloud LLM APIs plus a local Ollama model

## What was built

I wrote one small client per provider and one `agents.json` file that pins each agent to an exact model. Nothing switches model on its own, so the run record always shows which model answered. Valuation runs on Groq gpt-oss-120b instead of Mistral, because Mistral has no free API, and Gemini Flash-Lite is the backup a person switches to by hand. I also added a test that an unreachable Ollama fails the affordability step instead of sending the borrower's figures to a cloud model.

## Pull requests

| PR | Title | Merged | By |
|---|---|---|---|
| [#111](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/111) | AL-128 Add the provider clients and the per-agent model config | 2026-10-27 | Nic |
| [#174](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/174) | AL-29 Test that an unreachable Ollama fails the affordability step with no cloud fallback | 2026-11-06 | Nic |
