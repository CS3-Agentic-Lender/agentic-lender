"""agents.json: which provider and which exact model each agent uses.

It pins exact model IDs (never a moving alias like "latest") and has no fallback: if an agent's provider is down the
call fails. Moving an agent to another provider is an edit to this file, made by a person.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from app.llm import clients

DEFAULT_PATH = Path(__file__).with_name("agents.json")
TOP_LEVEL = {"agents", "backup"}  # nothing else, so a "fallback" section cannot sneak in


class ConfigError(ValueError):
    """The config file is not one we accept."""


@dataclass(frozen=True)
class AgentModel:
    provider: str
    model: str


@dataclass(frozen=True)
class Config:
    agents: dict[str, AgentModel]
    backup: dict[str, AgentModel]  # a model that is ready for an agent but only used when someone edits `agents`

    def agent(self, name: str) -> AgentModel:
        if name not in self.agents:
            raise ConfigError(f"no model is configured for the {name!r} agent")
        return self.agents[name]

    def smoke_models(self) -> dict[str, str]:
        """One model to smoke test for each provider, taken from the agents first and then the backups."""
        found: dict[str, str] = {}
        for entry in [*self.agents.values(), *self.backup.values()]:
            found.setdefault(entry.provider, entry.model)
        return found


def _entry(where: str, raw) -> AgentModel:
    if not isinstance(raw, dict) or set(raw) != {"provider", "model"}:
        raise ConfigError(f"{where} must have exactly a provider and a model")
    provider, model = raw["provider"], raw["model"]
    if provider not in clients.PROVIDERS:
        raise ConfigError(f"{where} has an unknown provider {provider!r}, expected one of {sorted(clients.PROVIDERS)}")
    if not isinstance(model, str) or not model.strip():
        raise ConfigError(f"{where} has no model")
    if "latest" in model.lower():
        raise ConfigError(f"{where} uses {model!r}, which is a moving alias: pin the exact model ID")
    return AgentModel(provider, model)


def load(path: Path = DEFAULT_PATH) -> Config:
    raw = json.loads(Path(path).read_text())
    extra = set(raw) - TOP_LEVEL
    if extra:
        raise ConfigError(f"unexpected section {sorted(extra)}: there is no fallback, only agents and backup")
    agents = {name: _entry(f"agents.{name}", item) for name, item in raw.get("agents", {}).items()}
    if not agents:
        raise ConfigError("agents is empty")
    backup = {name: _entry(f"backup.{name}", item) for name, item in raw.get("backup", {}).items()}
    return Config(agents, backup)
