"""One config file says which agent uses which model. It pins exact model IDs and has no fallback."""

import json

import pytest

from app.llm import clients, config


def write(tmp_path, data):
    path = tmp_path / "agents.json"
    path.write_text(json.dumps(data))
    return path


GOOD = {
    "agents": {
        "valuation": {"provider": "mistral", "model": "mistral-small-2603"},
        "market": {"provider": "gemini", "model": "gemini-3.1-flash-lite"},
    },
    "backup": {"valuation": {"provider": "groq", "model": "openai/gpt-oss-120b"}},
}


def test_the_real_config_loads_and_pins_a_model_for_every_agent():
    cfg = config.load()
    assert {"valuation", "market", "strategist", "affordability"} <= set(cfg.agents)
    for agent in cfg.agents.values():
        assert agent.provider in clients.PROVIDERS and agent.model


def test_no_model_in_the_real_config_is_a_moving_alias():
    cfg = config.load()
    for agent in [*cfg.agents.values(), *cfg.backup.values()]:
        assert "latest" not in agent.model.lower()


def test_each_provider_has_one_model_to_smoke_test():
    assert set(config.load().smoke_models()) == {"gemini", "mistral", "groq", "ollama"}


def test_a_config_is_read_from_a_file(tmp_path):
    cfg = config.load(write(tmp_path, GOOD))
    assert cfg.agents["valuation"] == config.AgentModel("mistral", "mistral-small-2603")
    assert cfg.backup["valuation"] == config.AgentModel("groq", "openai/gpt-oss-120b")


@pytest.mark.parametrize("bad", [
    {"agents": {"valuation": {"provider": "openai", "model": "gpt-9"}}},
    {"agents": {"valuation": {"provider": "groq", "model": ""}}},
    {"agents": {"valuation": {"provider": "groq", "model": "llama-latest"}}},
    {"agents": {"valuation": {"provider": "groq"}}},
    {"agents": {"valuation": {"provider": "groq", "model": "openai/gpt-oss-120b", "fallback": "mistral"}}},
    {"agents": {"valuation": {"provider": "groq", "model": "openai/gpt-oss-120b"}}, "fallback": {}},
    {"agents": {}},
])
def test_a_bad_config_is_refused(tmp_path, bad):
    with pytest.raises(config.ConfigError):
        config.load(write(tmp_path, bad))


def test_asking_for_an_agent_that_is_not_configured_is_an_error(tmp_path):
    with pytest.raises(config.ConfigError):
        config.load(write(tmp_path, GOOD)).agent("strategist")


def test_moving_the_valuation_agent_from_mistral_to_groq_is_only_a_config_change(tmp_path):
    seen = []

    def transport(url, headers, body, timeout):
        seen.append(url)
        return 200, {}, json.dumps({"choices": [{"message": {"content": '{"ok": true}'}}], "usage": {}}).encode()

    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}
    env = {"MISTRAL_API_KEY": "m-key", "GROQ_API_KEY": "g-key"}
    before = config.load(write(tmp_path, GOOD)).agent("valuation")
    after_data = json.loads(json.dumps(GOOD))
    after_data["agents"]["valuation"] = after_data["backup"]["valuation"]
    after = config.load(write(tmp_path, after_data)).agent("valuation")
    for agent in (before, after):
        clients.complete_json(agent.provider, agent.model, "s", "u", schema, transport=transport, env=env)
    assert "mistral.ai" in seen[0] and "groq.com" in seen[1]


HOSTS = {"gemini": "generativelanguage.googleapis.com", "mistral": "api.mistral.ai", "groq": "api.groq.com", "ollama": "localhost:11434"}
REPLIES = {
    "gemini": {"candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}]},
    "ollama": {"message": {"content": '{"ok": true}'}},
}


@pytest.mark.parametrize("name", sorted(config.load().agents))
def test_every_agent_in_the_real_config_reaches_the_provider_it_names_and_only_that_one(name):
    agent = config.load().agent(name)
    calls = []

    def transport(url, headers, body, timeout):
        calls.append((url, json.loads(body)))
        return 200, {}, json.dumps(REPLIES.get(agent.provider, {"choices": [{"message": {"content": '{"ok": true}'}}]})).encode()

    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}
    env = {"GEMINI_API_KEY": "k", "MISTRAL_API_KEY": "k", "GROQ_API_KEY": "k"}
    result = clients.complete_json(agent.provider, agent.model, "s", "u", schema, transport=transport, env=env)
    assert len(calls) == 1 and HOSTS[agent.provider] in calls[0][0]
    assert agent.model in calls[0][0] + json.dumps(calls[0][1]) and result.model == agent.model
