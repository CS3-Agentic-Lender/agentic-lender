"""POST /core/applications/{id}/messages and /messages/read against an in-memory Firestore (AL-70)."""

import itertools

import pytest
from fastapi.testclient import TestClient
from google.cloud.firestore import SERVER_TIMESTAMP

from app import auth, messages
from app.main import app
from tests.test_applications import LATER

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
THREAD = "applications/app1/messages"


class Snap:
    def __init__(self, db, path, data):
        self.db, self.path, self.id, self._data = db, path, path.split("/")[-1], data
        self.exists = data is not None
        self.reference = Doc(db, path)

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class Doc:
    def __init__(self, db, path):
        self.db, self.path, self.id = db, path, path.split("/")[-1]

    def get(self):
        return Snap(self.db, self.path, self.db.store.get(self.path))

    def set(self, data):
        self.db.writes.append(("set", self.path))
        self.db.store[self.path] = {k: (LATER if v is SERVER_TIMESTAMP else v) for k, v in data.items()}

    def update(self, changes):
        self.db.writes.append(("update", self.path))
        self.db.store[self.path].update(changes)

    def collection(self, name):
        return Collection(self.db, f"{self.path}/{name}")


class Collection:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def document(self, doc_id=None):
        return Doc(self.db, f"{self.path}/{doc_id or next(self.db.ids)}")

    def where(self, filter):
        db, prefix, field, value = self.db, self.path + "/", filter.field_path, filter.value

        class Query:
            def stream(self):
                for path, data in list(db.store.items()):
                    if path.startswith(prefix) and "/" not in path[len(prefix):] and data.get(field) == value:
                        yield Snap(db, path, data)

        return Query()


class Batch:
    """Writes land together on commit, or not at all if the commit fails."""

    def __init__(self, db):
        self.db, self.pending = db, []

    def update(self, ref, changes):
        self.pending.append((ref.path, changes))

    def commit(self):
        if self.db.fail_commit:
            raise RuntimeError("commit failed")
        self.db.commits.append(len(self.pending))
        for path, changes in self.pending:
            Doc(self.db, path).update(changes)


class FakeDB:
    def __init__(self):
        self.store, self.writes, self.commits, self.fail_commit = {}, [], [], False
        self.ids = (f"msg{n}" for n in itertools.count(1))

    def collection(self, name):
        return Collection(self, name)

    def batch(self):
        return Batch(self)


@pytest.fixture
def world(monkeypatch):
    """A submitted application (borrower1, broker1), a Draft (borrower1, broker1) and one message from the broker."""
    db = FakeDB()
    db.store["applications/app1"] = {"borrowerId": "borrower1", "brokerId": "broker1", "status": "Applied"}
    db.store["applications/draft1"] = {"borrowerId": "borrower1", "brokerId": "broker1", "status": "Draft"}
    db.store[f"{THREAD}/old"] = {"senderId": "broker1", "senderRole": "broker", "text": "Hi Alice", "sentAt": LATER, "read": False}
    state = {"db": db, "claims": {"uid": "borrower1", "role": "borrower"}}
    monkeypatch.setattr(messages, "db", lambda: db)
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: state["claims"])
    return state


def sign_in(world, uid, role):
    world["claims"] = {"uid": uid, "role": role}


def send(text="Hello", app_id="app1", **extra):
    return client.post(f"/core/applications/{app_id}/messages", json={"text": text, **extra}, headers=TOKEN)


def mark(app_id="app1"):
    return client.post(f"/core/applications/{app_id}/messages/read", headers=TOKEN)


def thread(world):
    return {path.split("/")[-1]: data for path, data in world["db"].store.items() if path.startswith(THREAD + "/")}


# ---- sending (AC1, AC3) -------------------------------------------------------------------------------------------


@pytest.mark.parametrize("uid,role", [("borrower1", "borrower"), ("broker1", "broker"), ("underwriter1", "underwriter")])
def test_the_borrower_the_assigned_broker_and_any_underwriter_can_send(world, uid, role):
    sign_in(world, uid, role)
    r = send("Can you send your payslips?")
    assert r.status_code == 201
    body = r.json()
    assert body["sender_id"] == uid and body["sender_role"] == role and body["read"] is False
    assert body["text"] == "Can you send your payslips?" and body["application_id"] == "app1"
    assert body["sent_at"] == "2026-10-14T09:00:00.000Z"
    assert thread(world)[body["id"]] == {"senderId": uid, "senderRole": role, "text": "Can you send your payslips?", "sentAt": LATER, "read": False}


def test_the_sender_comes_from_the_token_and_cannot_be_set_in_the_body(world):
    r = send("Hi", senderId="underwriter9", sender_id="underwriter9", senderRole="underwriter", sender_role="underwriter", read=True)
    assert r.status_code == 201
    stored = thread(world)[r.json()["id"]]
    assert stored["senderId"] == "borrower1" and stored["senderRole"] == "borrower" and stored["read"] is False


@pytest.mark.parametrize("uid,role", [("borrower2", "borrower"), ("broker2", "broker")])
def test_anyone_else_gets_404_and_nothing_is_written(world, uid, role):
    sign_in(world, uid, role)
    before = dict(world["db"].store)
    assert send().status_code == 404
    assert world["db"].store == before


def test_an_unknown_application_is_404(world):
    assert send(app_id="nope").status_code == 404 and mark(app_id="nope").status_code == 404


def test_the_text_is_trimmed_and_may_not_be_blank_or_too_long(world):
    assert send("  hello  ").json()["text"] == "hello"
    for bad in ("", "   ", "x" * (messages.MAX_TEXT + 1)):
        r = send(bad)
        assert r.status_code == 422 and r.json()["error"]["field"] == "text"
    assert send("x" * messages.MAX_TEXT).status_code == 201


def test_a_missing_text_is_422_naming_the_field(world):
    r = client.post("/core/applications/app1/messages", json={}, headers=TOKEN)
    assert r.status_code == 422 and r.json()["error"]["field"] == "text"


def test_a_draft_has_no_thread_for_anyone(world):
    for uid, role in [("borrower1", "borrower"), ("broker1", "broker"), ("underwriter1", "underwriter")]:
        sign_in(world, uid, role)
        r = send(app_id="draft1")
        assert r.status_code == 409 and "submitted" in r.json()["error"]["message"]
        assert mark(app_id="draft1").status_code == 409
    assert not any(path.startswith("applications/draft1/messages") for path in world["db"].store)


def test_a_message_needs_a_token():
    assert client.post("/core/applications/app1/messages", json={"text": "hi"}).status_code == 401
    assert client.post("/core/applications/app1/messages/read").status_code == 401


# ---- marking read (AC4) --------------------------------------------------------------------------------------------


def test_the_borrower_marks_the_brokers_unread_message_as_read(world):
    r = mark()
    assert r.status_code == 200 and r.json() == {"marked": 1}
    assert thread(world)["old"]["read"] is True


def test_a_users_own_messages_are_not_marked_by_them(world):
    sign_in(world, "broker1", "broker")
    assert mark().json() == {"marked": 0}
    assert thread(world)["old"]["read"] is False


def test_each_side_clears_what_the_other_sent(world):
    send("From Alice")
    sign_in(world, "broker1", "broker")
    assert mark().json() == {"marked": 1}  # Alice's message, not their own
    sign_in(world, "borrower1", "borrower")
    assert mark().json() == {"marked": 1}  # the broker's "old" message
    assert all(m["read"] for m in thread(world).values())


def test_a_broker_opening_the_thread_does_not_clear_the_underwriters_message_to_the_borrower(world):
    sign_in(world, "underwriter1", "underwriter")
    note = send("We need one more document").json()["id"]
    sign_in(world, "broker1", "broker")
    assert mark().json() == {"marked": 0}
    assert thread(world)[note]["read"] is False and thread(world)["old"]["read"] is False
    sign_in(world, "borrower1", "borrower")
    assert mark().json() == {"marked": 2}  # the broker's and the underwriter's, now that the borrower has seen them
    assert thread(world)[note]["read"] is True


def test_the_borrowers_message_is_cleared_by_a_broker_or_an_underwriter_for_both(world):
    note = send("My payslips").json()["id"]
    sign_in(world, "underwriter1", "underwriter")
    assert mark().json() == {"marked": 1}
    assert thread(world)[note]["read"] is True


def test_staff_messages_to_each_other_are_left_for_the_later_unread_ticket(world):
    sign_in(world, "underwriter1", "underwriter")
    note = send("Broker, can you confirm the income?").json()["id"]
    sign_in(world, "broker1", "broker")
    assert mark().json() == {"marked": 0}
    sign_in(world, "underwriter1", "underwriter")
    assert mark().json() == {"marked": 0}
    assert thread(world)[note]["read"] is False


def test_the_messages_are_marked_together_or_not_at_all(world):
    send("one"), send("two")
    sign_in(world, "broker1", "broker")
    world["db"].fail_commit = True
    with pytest.raises(RuntimeError):
        mark()
    assert [m["read"] for p, m in world["db"].store.items() if p.startswith(THREAD + "/") and m["senderRole"] == "borrower"] == [False, False]


def test_a_large_thread_is_marked_in_batches_within_the_firestore_limit(world, monkeypatch):
    monkeypatch.setattr(messages, "BATCH", 3)
    for n in range(7):
        send(f"message {n}")
    sign_in(world, "underwriter1", "underwriter")
    assert mark().json() == {"marked": 7}
    assert world["db"].commits == [3, 3, 1]


def test_marking_read_again_changes_nothing(world):
    mark()
    writes = len(world["db"].writes)
    assert mark().json() == {"marked": 0}
    assert len(world["db"].writes) == writes


def test_marking_read_only_changes_the_read_flag(world):
    before = dict(thread(world)["old"])
    mark()
    after = dict(thread(world)["old"])
    assert {k: v for k, v in after.items() if k != "read"} == {k: v for k, v in before.items() if k != "read"}


def test_marking_read_on_someone_elses_application_is_404_and_changes_nothing(world):
    sign_in(world, "borrower2", "borrower")
    assert mark().status_code == 404
    assert thread(world)["old"]["read"] is False


# ---- no editing or deleting (AC5) ----------------------------------------------------------------------------------


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_a_sent_message_cannot_be_edited_or_deleted(world, method):
    before = dict(world["db"].store)
    kwargs = {} if method == "delete" else {"json": {"text": "changed"}}
    r = getattr(client, method)("/core/applications/app1/messages/old", headers=TOKEN, **kwargs)
    assert r.status_code in (404, 405)
    assert world["db"].store == before


def test_the_messages_routes_are_only_the_two_post_endpoints():
    paths = client.get("/core/openapi.json").json()["paths"]
    found = {(method.upper(), path) for path, item in paths.items() if "/messages" in path for method in item}
    assert found == {("POST", "/core/applications/{application_id}/messages"), ("POST", "/core/applications/{application_id}/messages/read")}
