"""Smoke test the provider clients: one tiny structured-output request per provider, saved as evidence.

    cd al-ai && uv run python -m app.llm.smoke              # all four providers
    cd al-ai && uv run python -m app.llm.smoke groq gemini  # just these

Keys are read from the repo-root .env (or the environment) and are never printed or saved. A provider with no key is
skipped. Each call is a few tokens, so it stays far inside every free tier. The results go to docs/llm-smoke-results.json.
"""

import json
import sys
from datetime import date
from pathlib import Path

from app.llm import clients, config

AL_AI = Path(__file__).resolve().parents[2]
ENV_PATH = AL_AI.parent / ".env"
EVIDENCE_PATH = AL_AI / "docs" / "llm-smoke-results.json"

SCHEMA = {"type": "object", "properties": {"answer": {"type": "integer"}}, "required": ["answer"], "additionalProperties": False}
SYSTEM = "You reply only with JSON that matches the schema."
USER = "What is 2 plus 2? Put the number in the answer field."
EXPECTED = 4


def load_env(path: Path = ENV_PATH, base: dict | None = None) -> dict:
    """The environment plus the KEY=VALUE lines of a .env file. What is already set wins over the file."""
    import os

    env = dict(os.environ if base is None else base)
    try:
        lines = Path(path).read_text().splitlines()
    except FileNotFoundError:
        return env
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        env.setdefault(name.strip(), value.strip())
    return env


def run(models: dict[str, str], *, env: dict, transport=clients.urllib_transport, only: list[str] | None = None) -> list[dict]:
    """Smoke test each provider. `models` maps a provider to the model to test."""
    results = []
    for provider, model in models.items():
        if only and provider not in only:
            continue
        key_name = clients.PROVIDERS[provider].key_name
        if key_name and not env.get(key_name):
            results.append({"provider": provider, "model": model, "status": "skipped", "reason": f"{key_name} is not set"})
            continue
        try:
            got = clients.complete_json(provider, model, SYSTEM, USER, SCHEMA, transport=transport, env=env)
        except clients.LlmError as exc:  # the message is already scrubbed of the key
            results.append({"provider": provider, "model": model, "status": "failed", "reason": str(exc)})
            continue
        entry = {
            "provider": provider, "model": model, "raw_reply": got.raw_reply, "input_tokens": got.input_tokens,
            "output_tokens": got.output_tokens, "request_id": got.request_id, "duration_s": got.duration_s,
            "checked_on": date.today().isoformat(),
        }
        if got.parsed["answer"] == EXPECTED:
            results.append({"status": "passed", **entry})
        else:
            results.append({"status": "failed", "reason": f"the answer was {got.parsed['answer']}, expected {EXPECTED}", **entry})
    return results


def save(results: list[dict], path: Path = EVIDENCE_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    note = "One tiny structured-output request per provider. No keys are stored here. A skipped provider had no key set."
    path.write_text(json.dumps({"what": note, "schema": SCHEMA, "prompt": USER, "results": results}, indent=1) + "\n")
    return path


def main(argv: list[str]) -> int:
    results = run(config.load().smoke_models(), env=load_env(), only=argv or None)
    for r in results:
        detail = r.get("reason") or f"{r['duration_s']}s, {r['input_tokens']} in, {r['output_tokens']} out, request {r['request_id']}"
        print(f"{r['status']:8} {r['provider']:8} {r['model']:26} {detail}")
    print("saved", save(results))
    return 0 if all(r["status"] != "failed" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
