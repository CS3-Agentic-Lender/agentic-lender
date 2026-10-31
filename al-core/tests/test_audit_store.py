"""Anchoring a signed-off application (AL-172) against an in-memory Firestore and a stand-in registry."""

import pytest
from google.cloud.firestore import SERVER_TIMESTAMP

from app import audit, audit_store
from app.audit import AuditRecordError
from app.chain import ChainError, Stored
from tests.test_audit_record import FUNDED, as_datetime, funded_inputs

NOW = as_datetime("2026-10-30T12:00:00.000Z")


class Snap:
    def __init__(self, doc_id, data):
        self.id, self._data = doc_id, data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class Doc:
    def __init__(self, db, path):
        self.db, self.path, self.id = db, path, path.split("/")[-1]

    def get(self):
        return Snap(self.id, self.db.store.get(self.path))

    def set(self, data):
        self.db.writes.append(("set", self.path))
        self.db.store[self.path] = dict(data)

    def update(self, changes):
        self.db.writes.append(("update", self.path))
        self.db.store[self.path].update({k: (NOW if v is SERVER_TIMESTAMP else v) for k, v in changes.items()})

    def collection(self, name):
        return Collection(self.db, f"{self.path}/{name}")


class Collection:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def document(self, doc_id):
        return Doc(self.db, f"{self.path}/{doc_id}")

    def where(self, filter):
        field, value = filter.field_path, filter.value
        db, prefix = self.db, self.path + "/"

        class Query:
            def stream(self):
                for path, data in list(db.store.items()):
                    if path.startswith(prefix) and "/" not in path[len(prefix):] and data.get(field) == value:
                        yield Snap(path.split("/")[-1], data)

        return Query()


class FakeDB:
    def __init__(self):
        self.store, self.writes = {}, []

    def collection(self, name):
        return Collection(self, name)


class FakeRegistry:
    def __init__(self, result=None, error=None):
        self.result = result or Stored(tx_hash="0x" + "cd" * 32, already_stored=False)
        self.error, self.calls = error, []

    def store(self, application_id, audit_hash):
        self.calls.append((application_id, audit_hash))
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
def world(monkeypatch):
    """app-funded's documents, as the seed writes them, in a fake Firestore."""
    db = FakeDB()
    application, run, calls = funded_inputs()
    db.store["applications/app-funded"] = {**application, "status": "Underwriter Approved", "borrowerId": "borrower1"}
    db.store["ai_runs/run-app-funded"] = {**run, "applicationId": "app-funded", "startedAt": as_datetime("2026-09-11T09:00:00.000Z")}
    for call_id, doc in calls:
        db.store[f"ai_calls/{call_id}"] = doc
    monkeypatch.setattr(audit_store, "db", lambda: db)
    return db


# ---- the happy path ---------------------------------------------------------------------------------------------------


def test_anchoring_builds_saves_and_registers_the_seeded_record(world):
    registry = FakeRegistry()
    done = audit_store.anchor("app-funded", registry)
    assert done.audit_hash == FUNDED["hash"] and done.record == FUNDED["record"]
    assert registry.calls == [("app-funded", FUNDED["hash"])]
    assert done.tx_hash == "0x" + "cd" * 32 and done.already_stored is False


def test_the_record_is_saved_with_its_hash_where_the_rules_let_staff_read_it(world):
    audit_store.anchor("app-funded", FakeRegistry())
    assert world.store["applications/app-funded/audit/record"] == {**FUNDED["record"], "auditHash": FUNDED["hash"]}


def test_the_saved_record_hashes_to_its_own_audit_hash_when_read_back(world):
    audit_store.anchor("app-funded", FakeRegistry())
    saved = world.store["applications/app-funded/audit/record"]
    assert audit.audit_hash(saved) == saved["auditHash"]


def test_the_registry_transaction_is_kept_on_the_application(world):
    audit_store.anchor("app-funded", FakeRegistry())
    application = world.store["applications/app-funded"]
    assert application["auditTxHash"] == "0x" + "cd" * 32 and application["updatedAt"] == NOW


# ---- calling it again -------------------------------------------------------------------------------------------------


def test_anchoring_twice_saves_nothing_new_and_keeps_the_first_transaction(world):
    audit_store.anchor("app-funded", FakeRegistry())
    writes_before = list(world.writes)
    again = audit_store.anchor("app-funded", FakeRegistry(Stored(tx_hash=None, already_stored=True)))
    assert again.already_stored is True and again.tx_hash is None and again.audit_hash == FUNDED["hash"]
    assert world.writes == writes_before
    assert world.store["applications/app-funded"]["auditTxHash"] == "0x" + "cd" * 32


def test_a_record_saved_by_a_crashed_attempt_is_registered_by_the_retry(world):
    failing = FakeRegistry(error=ChainError("the audit hash could not be stored: ConnectionError"))
    with pytest.raises(ChainError):
        audit_store.anchor("app-funded", failing)
    assert world.store["applications/app-funded/audit/record"]["auditHash"] == FUNDED["hash"]
    assert "auditTxHash" not in world.store["applications/app-funded"]

    done = audit_store.anchor("app-funded", FakeRegistry())
    assert done.tx_hash and world.store["applications/app-funded"]["auditTxHash"] == done.tx_hash


# ---- never replacing a record -----------------------------------------------------------------------------------------


def test_a_saved_record_with_another_hash_is_never_replaced_and_nothing_is_sent_to_the_chain(world):
    world.store["applications/app-funded/audit/record"] = {"auditHash": "f" * 64, "applicationId": "app-funded"}
    registry = FakeRegistry()
    with pytest.raises(AuditRecordError, match="different hash"):
        audit_store.anchor("app-funded", registry)
    assert registry.calls == []
    assert world.store["applications/app-funded/audit/record"]["auditHash"] == "f" * 64


def test_a_change_to_the_documents_after_anchoring_is_caught_not_overwritten(world):
    audit_store.anchor("app-funded", FakeRegistry())
    world.store["ai_runs/run-app-funded"]["creditMemo"] += " (edited)"
    registry = FakeRegistry()
    with pytest.raises(AuditRecordError, match="different hash"):
        audit_store.anchor("app-funded", registry)
    assert registry.calls == []


# ---- which run, and what is missing -----------------------------------------------------------------------------------


def test_the_latest_complete_run_is_the_one_that_is_hashed(world):
    world.store["ai_runs/run-old"] = {"applicationId": "app-funded", "status": "complete", "creditMemo": "Older memo", "startedAt": as_datetime("2026-09-01T09:00:00.000Z")}
    world.store["ai_runs/run-failed"] = {"applicationId": "app-funded", "status": "failed", "creditMemo": "Failed memo", "startedAt": as_datetime("2026-10-01T09:00:00.000Z")}
    world.store["ai_runs/run-other-app"] = {"applicationId": "app-closed", "status": "complete", "creditMemo": "Another application", "startedAt": as_datetime("2026-10-02T09:00:00.000Z")}
    assert audit_store.anchor("app-funded", FakeRegistry()).audit_hash == FUNDED["hash"]


def test_only_the_calls_of_the_chosen_run_are_listed(world):
    world.store["ai_calls/call-from-another-run"] = {"runId": "run-old", "createdAt": as_datetime("2026-09-01T09:00:00.000Z")}
    assert audit_store.anchor("app-funded", FakeRegistry()).audit_hash == FUNDED["hash"]


def test_an_unknown_application_is_an_error(world):
    with pytest.raises(AuditRecordError, match="No application"):
        audit_store.anchor("nope", FakeRegistry())


def test_no_complete_run_is_an_error_and_nothing_is_written(world):
    world.store["ai_runs/run-app-funded"]["status"] = "running"
    registry = FakeRegistry()
    with pytest.raises(AuditRecordError, match="no complete AI run"):
        audit_store.anchor("app-funded", registry)
    assert registry.calls == [] and world.writes == []


def test_a_declined_application_has_no_audit_record(world):
    world.store["applications/app-funded"]["decision"]["outcome"] = "declined"
    registry = FakeRegistry()
    with pytest.raises(AuditRecordError, match="only an approved"):
        audit_store.anchor("app-funded", registry)
    assert registry.calls == [] and world.writes == []
