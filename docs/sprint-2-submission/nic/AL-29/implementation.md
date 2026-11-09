# AL-29: As a developer, the agents run on two cloud LLM APIs plus a local Ollama model

## What was built

I built one small client per provider and one agents.json file that pins each agent to an exact model, so nothing switches model on its own and the log always shows the model that really answered. Valuation runs on Groq's gpt-oss-120b instead of Mistral because Mistral's API isn't free. I also added a test that a dead Ollama fails the affordability step instead of sending the borrower's figures to a cloud model.

## Pull requests

| PR | Title | Merged | By |
|---|---|---|---|
| [#111](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/111) | AL-128 Add the provider clients and the per-agent model config | 2026-10-27 | Nic |
| [#174](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/174) | AL-29 Test that an unreachable Ollama fails the affordability step with no cloud fallback | 2026-11-06 | Nic |
