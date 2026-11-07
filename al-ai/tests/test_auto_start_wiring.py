"""The service starts the Firestore listener only when AUTO_START_COMMITTEE=true (AL-141). No Firestore needed: the listener is a stand-in."""

import pytest
from fastapi.testclient import TestClient

from app import auto_start
from app.main import app


class StandIn:
    def __init__(self):
        self.events = []

    def stop(self):
        self.events.append("stopped")


@pytest.fixture
def listener(monkeypatch):
    stand_in = StandIn()
    monkeypatch.setattr(auto_start, "start_from_env", lambda: stand_in.events.append("started") or stand_in)
    return stand_in


def test_the_listener_starts_with_the_service_and_stops_with_it_when_the_setting_is_on(listener, monkeypatch):
    monkeypatch.setenv("AUTO_START_COMMITTEE", "true")
    with TestClient(app):
        assert listener.events == ["started"]
    assert listener.events == ["started", "stopped"]


@pytest.mark.parametrize("value", [None, "", "false", "0"])
def test_the_listener_does_not_start_unless_the_setting_is_true(listener, monkeypatch, value):
    monkeypatch.delenv("AUTO_START_COMMITTEE", raising=False)
    if value is not None:
        monkeypatch.setenv("AUTO_START_COMMITTEE", value)
    with TestClient(app):
        pass
    assert listener.events == []
