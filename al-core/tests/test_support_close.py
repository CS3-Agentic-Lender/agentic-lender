"""The admin support request endpoints (close, notes, reopen) against an in-memory Firestore (AL-339)."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import Aborted, FailedPrecondition, InvalidArgument
from google.cloud.firestore import DELETE_FIELD, SERVER_TIMESTAMP

from app import auth, support_requests
from app.main import app

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
SENT = datetime(2026, 11, 16, 9, 30, 0, 250000, tzinfo=timezone.utc)
NOW = datetime(2026, 11, 24, 17, 0, 0, tzinfo=timezone.utc)
OPEN = {
    "userId": "borrower1", "category": "payment", "subject": "My fee did not go through",
    "message": "I paid the EUR 150 fee twice.", "applicationId": "app1", "status": "open", "createdAt": SENT,
}


class FakeSnap:
    def __init__(self, data, version):
        self._data, self.exists, self.update_time = data, data is not None, version

    def to_dict(self):
        return dict(self._data)


class FakeDoc:
    def __init__(self, db, collection, doc_id):
        self.db, self.parent, self.id = db, collection, doc_id

    def get(self, transaction=None):
        if transaction is not None:
            transaction.reads[(self.parent, self.id)] = self.db.versions.get((self.parent, self.id))
        # The real server refuses these ids on a read (checked against the emulator), with InvalidArgument.
        if self.id == ".." or (self.id.startswith("__") and self.id.endswith("__")):
            raise InvalidArgument(f'Resource id "{self.id}" is invalid')
        store = self.db.collections[self.parent]
        return FakeSnap(store.get(self.id), self.db.versions.get((self.parent, self.id)))

    def collection(self, name):
        return self.db.collection(f"{self.parent}/{self.id}/{name}")


class FakeCollection:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def document(self, doc_id=None):
        if doc_id is None:
            self.db.next_id += 1
            doc_id = f"auto{self.db.next_id}"
        return FakeDoc(self.db, self.name, doc_id)


class FakeOption:
    def __init__(self, last_update_time):
        self.last_update_time = last_update_time


class FakeBatch:
    """All writes land together or none do, and an update with a stale read time fails, as in Firestore."""

    def __init__(self, db):
        self.db, self.writes = db, []

    def update(self, ref, changes, option=None):
        self.writes.append(("update", ref, changes, option))

    def set(self, ref, data):
        self.writes.append(("set", ref, data, None))

    def commit(self):
        self.db.before_commit()
        for kind, ref, data, option in self.writes:
            if kind == "update":
                if ref.id not in self.db.collections[ref.parent]:
                    raise AssertionError("update of a missing document")
                if option and self.db.versions.get((ref.parent, ref.id)) != option.last_update_time:
                    raise FailedPrecondition("the document changed")
        for kind, ref, data, _ in self.writes:
            stored = {k: (NOW if v is SERVER_TIMESTAMP else v) for k, v in data.items()}
            store = self.db.collections[ref.parent]
            merged = {**store[ref.id], **stored} if kind == "update" else stored
            store[ref.id] = {k: v for k, v in merged.items() if v is not DELETE_FIELD}
            self.db.versions[(ref.parent, ref.id)] = self.db.versions.get((ref.parent, ref.id), 0) + 1


class FakeTransaction(FakeBatch):
    """A batch that also remembers what it read: if any of those documents changed before the commit, Firestore
    aborts it and firestore.transactional runs the function again."""

    _read_only, _max_attempts, _id = False, 5, b"tx"

    def _clean_up(self):
        self.writes, self.reads = [], {}

    def _begin(self, retry_id=None):
        pass

    def _commit(self):
        self.db.before_commit()
        if any(self.db.versions.get(key) != version for key, version in self.reads.items()):
            raise Aborted("a document this transaction read changed")
        self.db.before_commit = lambda: None  # the batch commit below must not run the hook a second time
        FakeBatch.commit(self)

    def _rollback(self):
        self._clean_up()


class FakeDB:
    def __init__(self):
        self.collections = {"support_requests": {"SR-OPEN0001": dict(OPEN)}, "admin_actions": {}}
        self.versions = {("support_requests", "SR-OPEN0001"): 1}
        self.next_id = 0
        self.before_commit = lambda: None

    def collection(self, path):
        top = path.split("/")[0]
        assert top in self.collections, path
        self.collections.setdefault(path, {})  # a subcollection, such as support_requests/{reference}/notes
        return FakeCollection(self, path)

    def batch(self):
        return FakeBatch(self)

    def transaction(self):
        return FakeTransaction(self)

    def write_option(self, last_update_time):
        return FakeOption(last_update_time)


@pytest.fixture
def fake(monkeypatch):
    """In-memory Firestore, signed in as the admin with uid admin1."""
    state = {"db": FakeDB(), "claims": {"uid": "admin1", "role": "admin"}}
    monkeypatch.setattr(support_requests, "db", lambda: state["db"])
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: state["claims"])
    return state


def close(reference="SR-OPEN0001", headers=TOKEN, **body):
    url = f"/core/admin/support-requests/{reference}/close"
    return client.post(url, headers=headers, json=body) if body else client.post(url, headers=headers)


def comment(text, reference="SR-OPEN0001", headers=TOKEN):
    return client.post(f"/core/admin/support-requests/{reference}/notes", headers=headers, json={"text": text})


def reopen(reference="SR-OPEN0001", headers=TOKEN):
    return client.post(f"/core/admin/support-requests/{reference}/reopen", headers=headers)


def notes(fake, reference="SR-OPEN0001"):
    return fake["db"].collections.get(f"support_requests/{reference}/notes", {})


def stored(fake, reference="SR-OPEN0001"):
    return fake["db"].collections["support_requests"][reference]


def actions(fake):
    return list(fake["db"].collections["admin_actions"].values())


# Closing


def test_closing_sets_the_status_the_time_and_who_closed_it(fake):
    r = close()
    assert r.status_code == 200, r.json()
    assert stored(fake) == {**OPEN, "status": "closed", "closedAt": NOW, "closedBy": "admin1"}


def test_the_reply_is_the_closed_request(fake):
    assert close().json() == {
        "reference": "SR-OPEN0001", "category": "payment", "subject": OPEN["subject"], "message": OPEN["message"],
        "application_id": "app1", "status": "closed", "created_at": "2026-11-16T09:30:00.250Z",
        "closed_at": "2026-11-24T17:00:00.000Z", "closed_by": "admin1", "resolution": None,
    }


def test_closing_is_logged_in_admin_actions(fake):
    close()
    assert actions(fake) == [{
        "actorUid": "admin1", "action": "close_support_request", "targetRef": "support_requests/SR-OPEN0001",
        "details": {"subject": OPEN["subject"], "userId": "borrower1"}, "createdAt": NOW,
    }]


# Idempotent: closing a closed request changes nothing and logs nothing


def test_closing_a_closed_request_is_a_200_that_changes_and_logs_nothing(fake):
    close()
    first = stored(fake)
    fake["claims"] = {"uid": "admin2", "role": "admin"}
    r = close()
    assert r.status_code == 200 and r.json()["status"] == "closed" and r.json()["closed_by"] == "admin1"
    assert stored(fake) == first
    assert len(actions(fake)) == 1


def test_a_close_that_loses_a_race_to_another_close_is_a_200_and_logs_once(fake):
    db = fake["db"]

    def another_admin_closes_first():
        db.before_commit = lambda: None
        db.collections["support_requests"]["SR-OPEN0001"].update({"status": "closed", "closedAt": SENT, "closedBy": "admin2"})
        db.versions[("support_requests", "SR-OPEN0001")] += 1

    db.before_commit = another_admin_closes_first
    r = close()
    assert r.status_code == 200 and r.json()["closed_by"] == "admin2"
    assert actions(fake) == []  # the other close wrote its own record; this one wrote nothing


# Not found


@pytest.mark.parametrize("reference", ["SR-NOPE0000", "..", "__name__"])
def test_an_unknown_reference_is_a_404_and_nothing_is_logged(fake, reference):
    r = close(reference)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert actions(fake) == []


# Admins only


@pytest.mark.parametrize("role", ["borrower", "broker", "underwriter", "Admin", None])
def test_only_an_admin_can_close(fake, role):
    fake["claims"] = {"uid": "borrower1", "role": role}
    assert close().status_code == 403
    assert stored(fake) == OPEN and actions(fake) == []


def test_no_token_is_a_401(fake):
    assert close(headers={}).status_code == 401
    assert stored(fake) == OPEN



# Closing with a resolution note


def test_a_resolution_note_is_stored_with_the_close_and_returned(fake):
    r = close(resolution="  Refunded the second EUR 150 fee.  ")
    assert r.status_code == 200, r.json()
    assert r.json()["resolution"] == "Refunded the second EUR 150 fee."
    assert stored(fake) == {
        **OPEN, "status": "closed", "closedAt": NOW, "closedBy": "admin1", "resolution": "Refunded the second EUR 150 fee.",
    }
    assert actions(fake)[0]["details"] == {
        "subject": OPEN["subject"], "userId": "borrower1", "resolution": "Refunded the second EUR 150 fee.",
    }


@pytest.mark.parametrize("body", [{"resolution": None}, {"resolution": "   "}])
def test_a_blank_resolution_closes_without_one(fake, body):
    r = close(**body)
    assert r.status_code == 200 and r.json()["resolution"] is None
    assert "resolution" not in stored(fake)
    assert "resolution" not in actions(fake)[0]["details"]


def test_a_resolution_over_2000_characters_is_a_422_and_nothing_changes(fake):
    r = close(resolution="x" * 2001)
    assert r.status_code == 422 and r.json()["error"]["field"] == "resolution"
    assert stored(fake) == OPEN and actions(fake) == []


# Notes


def test_a_note_is_added_and_returned(fake):
    r = comment("  Asked finance to check the second payment.  ")
    assert r.status_code == 201, r.json()
    note_id = r.json()["id"]
    assert r.json() == {
        "id": note_id, "author_uid": "admin1", "text": "Asked finance to check the second payment.",
        "created_at": "2026-11-24T17:00:00.000Z",
    }
    assert notes(fake) == {note_id: {"authorUid": "admin1", "text": "Asked finance to check the second payment.", "createdAt": NOW}}


def test_each_note_is_its_own_document_and_the_request_is_unchanged(fake):
    comment("First")
    comment("Second")
    assert sorted(n["text"] for n in notes(fake).values()) == ["First", "Second"]
    assert stored(fake) == OPEN


def test_a_note_is_logged_in_admin_actions(fake):
    note_id = comment("Called the borrower").json()["id"]
    assert actions(fake) == [{
        "actorUid": "admin1", "action": "comment_support_request", "targetRef": "support_requests/SR-OPEN0001",
        "details": {"subject": OPEN["subject"], "userId": "borrower1", "noteId": note_id}, "createdAt": NOW,
    }]


def test_a_resolved_request_refuses_a_note_with_a_409_and_writes_nothing(fake):
    close()
    logged = actions(fake)
    r = comment("Borrower confirmed the refund arrived")
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    assert r.json()["error"]["message"] == "This request is resolved. Reopen it to add a note."
    assert notes(fake) == {} and actions(fake) == logged


def test_a_note_that_races_a_close_is_a_409_and_writes_nothing(fake):
    db = fake["db"]

    def another_admin_closes_first():
        db.before_commit = lambda: None
        db.collections["support_requests"]["SR-OPEN0001"].update({"status": "closed", "closedAt": SENT, "closedBy": "admin2"})
        db.versions[("support_requests", "SR-OPEN0001")] += 1

    db.before_commit = another_admin_closes_first
    r = comment("Borrower confirmed the refund arrived")
    assert r.status_code == 409 and r.json()["error"]["message"] == "This request is resolved. Reopen it to add a note."
    assert notes(fake) == {} and actions(fake) == []


def test_a_reopened_request_takes_a_note_again(fake):
    close()
    reopen()
    assert comment("Borrower wrote back").status_code == 201
    assert len(notes(fake)) == 1


@pytest.mark.parametrize("text", ["", "   ", "x" * 2001])
def test_an_empty_or_long_note_is_a_422_and_nothing_is_written(fake, text):
    r = comment(text)
    assert r.status_code == 422 and r.json()["error"]["field"] == "text"
    assert notes(fake) == {} and actions(fake) == []


def test_a_note_of_exactly_2000_characters_is_accepted(fake):
    assert comment("x" * 2000).status_code == 201


@pytest.mark.parametrize("reference", ["SR-NOPE0000", "..", "__name__"])
def test_a_note_on_an_unknown_reference_is_a_404(fake, reference):
    r = comment("Hello", reference)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert actions(fake) == []


@pytest.mark.parametrize("role", ["borrower", "broker", "underwriter", None])
def test_only_an_admin_can_add_a_note(fake, role):
    fake["claims"] = {"uid": "borrower1", "role": role}
    assert comment("Hello").status_code == 403
    assert notes(fake) == {} and actions(fake) == []


def test_a_note_needs_a_token(fake):
    assert comment("Hello", headers={}).status_code == 401


# Reopening


def test_reopening_clears_the_close_and_the_resolution_and_keeps_the_notes(fake):
    comment("Checked the payment")
    close(resolution="Refunded")
    fake["claims"] = {"uid": "admin2", "role": "admin"}
    r = reopen()
    assert r.status_code == 200, r.json()
    assert r.json()["status"] == "open"
    assert r.json()["closed_at"] is None and r.json()["closed_by"] is None and r.json()["resolution"] is None
    assert stored(fake) == OPEN
    assert len(notes(fake)) == 1


def test_reopening_is_logged_in_admin_actions(fake):
    close()
    fake["claims"] = {"uid": "admin2", "role": "admin"}
    reopen()
    assert actions(fake)[-1] == {
        "actorUid": "admin2", "action": "reopen_support_request", "targetRef": "support_requests/SR-OPEN0001",
        "details": {"subject": OPEN["subject"], "userId": "borrower1"}, "createdAt": NOW,
    }


def test_reopening_an_open_request_is_a_200_that_changes_and_logs_nothing(fake):
    r = reopen()
    assert r.status_code == 200 and r.json()["status"] == "open"
    assert stored(fake) == OPEN and actions(fake) == []


def test_a_reopened_request_can_be_closed_again(fake):
    close(resolution="First answer")
    reopen()
    r = close(resolution="Second answer")
    assert r.json()["status"] == "closed" and r.json()["resolution"] == "Second answer"
    assert [a["action"] for a in actions(fake)] == ["close_support_request", "reopen_support_request", "close_support_request"]


def test_a_reopen_that_loses_a_race_to_another_reopen_is_a_200_and_logs_once(fake):
    close()
    db = fake["db"]

    def another_admin_reopens_first():
        db.before_commit = lambda: None
        db.collections["support_requests"]["SR-OPEN0001"] = dict(OPEN)
        db.versions[("support_requests", "SR-OPEN0001")] += 1

    db.before_commit = another_admin_reopens_first
    r = reopen()
    assert r.status_code == 200 and r.json()["status"] == "open"
    assert [a["action"] for a in actions(fake)] == ["close_support_request"]


@pytest.mark.parametrize("reference", ["SR-NOPE0000", "..", "__name__"])
def test_reopening_an_unknown_reference_is_a_404(fake, reference):
    r = reopen(reference)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize("role", ["borrower", "broker", "underwriter", None])
def test_only_an_admin_can_reopen(fake, role):
    close()
    fake["claims"] = {"uid": "borrower1", "role": role}
    assert reopen().status_code == 403
    assert stored(fake)["status"] == "closed" and len(actions(fake)) == 1


def test_reopening_needs_a_token(fake):
    assert reopen(headers={}).status_code == 401
