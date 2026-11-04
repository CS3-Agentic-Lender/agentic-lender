# Committee flow: real run evidence

Two runs of `cd al-ai && uv run python -m app.committee <application>` on 4 Nov 2026, with the models `app/llm/agents.json` names:
Gemini (`gemini-3.1-flash-lite`) for Market & Macro and the strategist, Groq (`openai/gpt-oss-120b`) for the valuation agent,
Ollama (`qwen3.5:9b`, local) for the affordability agent.

| File | Application | Result |
|---|---|---|
| `mortgage-run.json` | `committee_samples/mortgage-application.json` | complete, Approve -> Approve |
| `heloc-run.json` | `committee_samples/heloc-application.json` | complete, Approve -> Conditionally Approve (the gate added the HELOC conditions) |

Each file is the run record the runner saved: unique `run_id`, `node_order`, and every step's output with its provider, model and attempts.
The sample applications are synthetic. No keys are in the records.
