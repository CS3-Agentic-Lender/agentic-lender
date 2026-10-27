"""One small client for each model provider: Gemini, Mistral, Groq and Ollama.

Each call sends one structured-output request and returns the raw reply, the parsed JSON, the token counts when the
provider gives them and the provider's request ID. There is no retry and no fallback: if the provider fails the call
raises LlmError and the caller decides what to do. Moving an agent to another provider is a change in agents.json.

Keys come from the environment and only ever go in a request header. They are never logged, and they are scrubbed
from any error message in case a provider echoes them back.
"""

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable

log = logging.getLogger("al-ai.llm")

TIMEOUT_S = 60
# Groq sits behind Cloudflare, which answers HTTP 403 (error 1010) to Python's default "Python-urllib" User-Agent.
USER_AGENT = "al-ai/0.1 (+https://github.com/CS3-Agentic-Lender/agentic-lender)"
DEFAULT_OLLAMA_HOST = "http://localhost:11434"


class LlmError(Exception):
    """The call failed or the reply is not usable. The message never contains a key."""


class MissingKey(LlmError):
    """The key for this provider is not set. Nothing was sent."""


@dataclass(frozen=True)
class LlmResult:
    provider: str
    model: str
    raw_reply: str  # exactly the text the model produced
    parsed: dict  # that text as JSON, already checked against the schema
    input_tokens: int | None
    output_tokens: int | None
    request_id: str | None  # the provider's own ID for the call, where it gives one
    duration_s: float


# A transport sends one POST and returns (status, response headers with lowercase names, body bytes).
Transport = Callable[[str, dict, bytes, float], tuple[int, dict, bytes]]


def urllib_transport(url: str, headers: dict, body: bytes, timeout: float) -> tuple[int, dict, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as err:  # a 4xx or 5xx still carries a body that says why
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read()


# ---- the four providers: how to build the request and how to read the reply ---------------------------

def _openai_style(url: str, key: str, model: str, system: str, user: str, schema: dict):
    """Groq and Mistral both speak the same chat-completions format with a JSON schema."""
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "reply", "schema": schema, "strict": True}},
        "temperature": 0,
    }
    return url, headers, body


def _read_openai_style(headers: dict, body: dict):
    usage = body.get("usage") or {}
    return (
        body["choices"][0]["message"]["content"],
        usage.get("prompt_tokens"),
        usage.get("completion_tokens"),
        headers.get("x-request-id") or body.get("id"),
    )


def _build_groq(model, system, user, schema, key, env):
    return _openai_style("https://api.groq.com/openai/v1/chat/completions", key, model, system, user, schema)


def _build_mistral(model, system, user, schema, key, env):
    return _openai_style("https://api.mistral.ai/v1/chat/completions", key, model, system, user, schema)


def _build_gemini(model, system, user, schema, key, env):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {"x-goog-api-key": key, "Content-Type": "application/json"}
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": schema, "temperature": 0},
    }
    return url, headers, body


def _read_gemini(headers: dict, body: dict):
    usage = body.get("usageMetadata") or {}
    text = "".join(part.get("text", "") for part in body["candidates"][0]["content"]["parts"])
    return text, usage.get("promptTokenCount"), usage.get("candidatesTokenCount"), body.get("responseId")


def ollama_base_url(raw: str | None) -> str:
    """OLLAMA_HOST the way Ollama's own docs write it: a scheme and a port are both optional ("127.0.0.1:11434", "0.0.0.0")."""
    raw = (raw or "").strip() or DEFAULT_OLLAMA_HOST
    if "://" not in raw:
        raw = "http://" + raw
    try:
        parts = urllib.parse.urlsplit(raw)
        port = parts.port  # raises ValueError for a port that is not a number or is out of range
    except ValueError:
        raise LlmError("OLLAMA_HOST is not a usable address") from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise LlmError("OLLAMA_HOST is not a usable address")
    netloc = parts.netloc
    if port is None and parts.scheme == "http":
        netloc += ":11434"  # Ollama's default port
    return f"{parts.scheme}://{netloc}{parts.path.rstrip('/')}"


def _build_ollama(model, system, user, schema, key, env):
    host = ollama_base_url(env.get("OLLAMA_HOST"))
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": False,
        "think": False,  # a thinking model would otherwise spend its tokens before it answers
        "format": schema,
        "options": {"temperature": 0},
    }
    return f"{host}/api/chat", {"Content-Type": "application/json"}, body


def _read_ollama(headers: dict, body: dict):
    return body["message"]["content"], body.get("prompt_eval_count"), body.get("eval_count"), None  # Ollama has no request ID


@dataclass(frozen=True)
class Provider:
    key_name: str | None  # the environment setting that holds the key, None when no key is needed
    build: Callable
    read: Callable


PROVIDERS = {
    "gemini": Provider("GEMINI_API_KEY", _build_gemini, _read_gemini),
    "mistral": Provider("MISTRAL_API_KEY", _build_mistral, _read_openai_style),
    "groq": Provider("GROQ_API_KEY", _build_groq, _read_openai_style),
    "ollama": Provider(None, _build_ollama, _read_ollama),
}


# ---- checking the reply against the schema -----------------------------------------------------------------

_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "null": lambda v: v is None,
}


def schema_errors(value, schema: dict, path: str = "$") -> list[str]:
    """What is wrong with `value` against a small subset of JSON Schema (type, enum, properties, required, items). Empty means fine."""
    errors = []
    kind = schema.get("type")
    if kind and not _TYPES[kind](value):
        return [f"{path} should be {kind}"]
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path} should be one of {schema['enum']}")
    if isinstance(value, dict):
        for name in schema.get("required", []):
            if name not in value:
                errors.append(f"{path}.{name} is missing")
        known = schema.get("properties", {})
        for name, item in value.items():
            if name in known:
                errors += schema_errors(item, known[name], f"{path}.{name}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}.{name} is not allowed")
    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            errors += schema_errors(item, schema["items"], f"{path}[{i}]")
    return errors


# ---- the one call ----------------------------------------------------------------------------------------------

def complete_json(
    provider: str,
    model: str,
    system: str,
    user: str,
    schema: dict,
    *,
    transport: Transport = urllib_transport,
    env: dict | None = None,
    timeout: float = TIMEOUT_S,
) -> LlmResult:
    """Send one structured-output request to one provider. Raises LlmError if anything goes wrong; never calls another provider."""
    env = os.environ if env is None else env
    spec = PROVIDERS.get(provider)
    if spec is None:
        raise LlmError(f"unknown provider {provider!r}, expected one of {sorted(PROVIDERS)}")
    key = ""
    if spec.key_name:
        key = env.get(spec.key_name, "")
        if not key:
            raise MissingKey(f"{spec.key_name} is not set")

    def clean(text: str) -> str:  # a provider may echo the key back in an error, so it is scrubbed from everything we keep
        return text.replace(key, "[key]") if key else text

    entry = {"provider": provider, "model": model, "outcome": None, "request_id": None, "input_tokens": None, "output_tokens": None}
    started = time.monotonic()
    try:
        url, headers, body = spec.build(model, system, user, schema, key, env)
        headers = {**headers, "User-Agent": USER_AGENT}
        try:
            status, response_headers, raw = transport(url, headers, json.dumps(body).encode(), timeout)
        except OSError as exc:  # no connection, a timeout, a refused connection
            raise LlmError(clean(f"{provider} could not be reached ({type(exc).__name__}: {exc})")) from None
        if status != 200:
            raise LlmError(clean(f"{provider} answered HTTP {status}: {raw.decode(errors='replace')[:300]}"))
        try:
            text, input_tokens, output_tokens, request_id = spec.read(response_headers, json.loads(raw))
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            raise LlmError(f"{provider} sent a reply in a shape we do not recognise") from None
        entry.update(request_id=request_id, input_tokens=input_tokens, output_tokens=output_tokens)
        try:
            parsed = json.loads(text)
        except (TypeError, ValueError):
            raise LlmError(f"{provider} did not reply with JSON") from None
        problems = schema_errors(parsed, schema)
        if problems:
            raise LlmError(f"{provider} reply does not match the schema: {'; '.join(problems[:3])}")
        entry["outcome"] = "ok"
        return LlmResult(provider, model, text, parsed, input_tokens, output_tokens, request_id, round(time.monotonic() - started, 3))
    except LlmError as exc:
        entry.update(outcome="error", error=clean(str(exc)))
        raise
    finally:
        entry["duration_s"] = round(time.monotonic() - started, 3)
        log.info(json.dumps(entry))
