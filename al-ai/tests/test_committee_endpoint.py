"""POST /ai/committee/runs: an underwriter re-runs a failed or stale committee run.

The first part needs no Firestore: the listener is a stand-in, so these check the token, the role and how each answer of
Listener.rerun becomes a status code. The second part runs the real listener against the Firestore emulator (skipped
without FIRESTORE_EMULATOR_HOST, like test_auto_start.py), with the same fake providers, so no key or model is used.
"""

import threading
import urllib.request

import pytest
from fastapi.testclient import TestClient
from google.cloud.firestore_v1.base_query import FieldFilter

import test_auto_start as ta
import test_committee as tc
from app import auth, auto_start
from app.main import app

AUTH = {"Authorization": "Bearer ok"}


@pytest.fixture
def signed_in(monkeypatch):
    role = {"value": "underwriter"}
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: {"uid": "u1", "role": role["value"]})
    return role


class StandIn:
    def __init__(self, answer):
        self.answer, self.asked = answer, []

    def rerun(self, application_id):
        self.asked.append(application_id)
        return self.answer


@pytest.fixture
def listener_answers(monkeypatch):
    def install(answer):
        stand_in = StandIn(answer)
        monkeypatch.setattr(app.state, "committee_listener", stand_in, raising=False)
        return stand_in

    return install


def post(body, headers=AUTH):
    return TestClient(app).post("/ai/committee/runs", json=body, headers=headers)


def test_a_started_re_run_answers_201_with_the_run_and_its_trigger(signed_in, listener_answers):
    stand_in = listener_answers(auto_start.RerunStarted("run-2"))
    r = post({"application_id": "app-1"})
    assert r.status_code == 201
    assert r.json() == {"run_id": "run-2", "application_id": "app-1", "status": "running", "trigger": "rerun"}
    assert stand_in.asked == ["app-1"]


def test_no_token_is_401(listener_answers):
    stand_in = listener_answers(auto_start.RerunStarted("run-2"))
    r = post({"application_id": "app-1"}, headers={})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert stand_in.asked == []


@pytest.mark.parametrize("role", ["broker", "borrower", None])
def test_only_an_underwriter_may_re_run(signed_in, listener_answers, role):
    signed_in["value"] = role
    stand_in = listener_answers(auto_start.RerunStarted("run-2"))
    r = post({"application_id": "app-1"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert stand_in.asked == []


@pytest.mark.parametrize("reason, status, code", [
    (auto_start.Refusal.NOT_FOUND, 404, "NOT_FOUND"),
    (auto_start.Refusal.RUNNING, 409, "CONFLICT"),
    (auto_start.Refusal.NOTHING_TO_RERUN, 409, "CONFLICT"),
    (auto_start.Refusal.STOPPING, 503, "UPSTREAM_UNAVAILABLE"),
])
def test_each_refusal_has_its_status(signed_in, listener_answers, reason, status, code):
    listener_answers(auto_start.RerunRefused(reason))
    r = post({"application_id": "app-1"})
    assert r.status_code == status and r.json()["error"]["code"] == code


def test_without_the_listener_the_service_answers_503_and_says_why(signed_in, monkeypatch):
    monkeypatch.setattr(app.state, "committee_listener", None, raising=False)
    r = post({"application_id": "app-1"})
    assert r.status_code == 503 and "AUTO_START_COMMITTEE" in r.json()["error"]["message"]


@pytest.mark.parametrize("body", [{}, {"application_id": ""}, {"application_id": "a/b"}, {"application_id": "app-1", "x": 1}])
def test_a_bad_body_is_422(signed_in, listener_answers, body):
    stand_in = listener_answers(auto_start.RerunStarted("run-2"))
    assert post(body).status_code == 422
    assert stand_in.asked == []


def test_the_service_hands_the_endpoint_its_listener_while_it_runs(signed_in, monkeypatch):
    stand_in = StandIn(auto_start.RerunStarted("run-9"))
    monkeypatch.setattr(auto_start, "start_from_env", lambda: stand_in)
    monkeypatch.setenv("AUTO_START_COMMITTEE", "true")
    stand_in.stop = lambda: None
    with TestClient(app) as client:
        assert client.post("/ai/committee/runs", json={"application_id": "app-1"}, headers=AUTH).status_code == 201
    assert app.state.committee_listener is None


# ---- against the Firestore emulator, with the real listener ----------------------------------------------

emulator = pytest.mark.skipif(not ta.EMULATOR, reason="needs the Firestore emulator (set FIRESTORE_EMULATOR_HOST)")


@pytest.fixture
def db():
    from google.cloud import firestore

    request = urllib.request.Request(f"http://{ta.EMULATOR}/emulator/v1/projects/demo-al/databases/(default)/documents", method="DELETE")
    urllib.request.urlopen(request).read()
    return firestore.Client(project="demo-al")


@pytest.fixture
def listener(db, monkeypatch, signed_in):
    """The real listener (not started: no watch, no sweep), handed to the endpoint as the service does."""
    real = auto_start.Listener(db, ta.factory())
    monkeypatch.setattr(app.state, "committee_listener", real, raising=False)
    yield real
    real.stop()


def failed_application(db) -> tuple[str, str]:
    application_id = ta.applied(db)
    failed = auto_start.process(db, application_id, deps_factory=ta.factory(tc.Providers(ollama=(500, b"boom"))))
    return application_id, failed["run_id"]


@emulator
def test_a_failed_run_is_re_run_in_the_background_and_the_new_run_points_back_at_it(db, listener):
    application_id, failed_run = failed_application(db)
    r = post({"application_id": application_id})
    assert r.status_code == 201
    body = r.json()
    assert (body["application_id"], body["status"], body["trigger"]) == (application_id, "running", "rerun")
    run = ta.run_doc(db, body["run_id"])
    assert (run["trigger"], run["rerunOf"]) == ("rerun", failed_run)
    listener.pool.shutdown(wait=True)  # let the background run finish
    assert ta.application(db, application_id)["status"] == "AI Deliberated"
    assert ta.run_doc(db, body["run_id"])["status"] == "complete"


@emulator
def test_a_stale_run_is_re_run_and_marked_interrupted(db, listener):
    application_id, stale = ta.left_running(db, 11)
    r = post({"application_id": application_id})
    assert r.status_code == 201
    assert ta.run_doc(db, stale)["failureReason"] == auto_start.INTERRUPTED
    assert ta.run_doc(db, r.json()["run_id"])["rerunOf"] == stale


@emulator
def test_a_run_still_going_is_409_and_left_alone(db, listener):
    application_id, running = ta.left_running(db, 1)
    r = post({"application_id": application_id})
    assert r.status_code == 409
    assert ta.application(db, application_id)["aiRunId"] == running
    assert ta.run_doc(db, running)["status"] == "running"


@emulator
def test_a_complete_run_or_one_never_run_is_409(db, listener):
    done = ta.applied(db)
    auto_start.process(db, done, deps_factory=ta.factory())
    never = ta.applied(db)
    assert post({"application_id": done}).status_code == 409
    assert post({"application_id": never}).status_code == 409
    assert len(ta.runs_for(db, done)) == 1 and ta.runs_for(db, never) == []


@emulator
def test_an_unknown_application_is_404(db, listener):
    assert post({"application_id": "no-such-app"}).status_code == 404


@emulator
def test_two_calls_at_once_start_one_run(db, listener):
    application_id, failed_run = failed_application(db)
    barrier, statuses = threading.Barrier(2), []

    def call():
        barrier.wait()
        statuses.append(post({"application_id": application_id}).status_code)

    threads = [threading.Thread(target=call) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(statuses) == [201, 409]
    reruns = db.collection("ai_runs").where(filter=FieldFilter("rerunOf", "==", failed_run)).get()
    assert len(reruns) == 1
