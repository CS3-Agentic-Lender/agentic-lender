"""POST /core/support-requests against an in-memory Firestore (AL-73)."""

import re
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import AlreadyExists, InvalidArgument
from google.cloud.firestore import SERVER_TIMESTAMP

from app import auth, support_requests
from app.main import app

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
NOW = datetime(2026, 11, 16, 9, 30, 0, 250000, tzinfo=timezone.utc)
REFERENCE = re.compile(r"^SR-[2-9A-HJKMNP-Z]{8}$")

REQUEST = {"category": "payment", "subject": "My fee did not go through", "message": "I paid the EUR 150 fee twice."}


class FakeSnap:
    def __init__(self, data):
        self._data, self.exists = data, data is not None

    def to_dict(self):
        return dict(self._data)


class FakeDoc:
    def __init__(self, db, doc_id):
        self.db, self.id = db, doc_id

    def create(self, data):
        if self.id in self.db.store:
            raise AlreadyExists("document exists")
        self.db.store[self.id] = {k: (NOW if v is SERVER_TIMESTAMP else v) for k, v in data.items()}

    def get(self):
        return FakeSnap(self.db.store[self.id])


class FakeApplicationDoc:
    def __init__(self, db, doc_id):
        self.db, self.id = db, doc_id

    def get(self):
        # The real server refuses these ids on a read (checked against the emulator), with InvalidArgument.
        if self.id == ".." or (self.id.startswith("__") and self.id.endswith("__")):
            raise InvalidArgument(f'Resource id "{self.id}" is invalid')
        return FakeSnap(self.db.applications.get(self.id))


class FakeApplications:
    def __init__(self, db):
        self.db = db

    def document(self, doc_id):
        return FakeApplicationDoc(self.db, doc_id)


class FakeDB:
    def __init__(self):
        self.store = {}
        self.applications = {
            "app1": {"borrowerId": "borrower1", "status": "Applied"},
            "app2": {"borrowerId": "borrower2", "status": "Applied"},
        }

    def collection(self, name):
        if name == "applications":
            return FakeApplications(self)
        assert name == "support_requests"
        return self

    def document(self, doc_id):
        return FakeDoc(self, doc_id)


@pytest.fixture
def fake(monkeypatch):
    """In-memory Firestore, signed in as the borrower with uid borrower1."""
    state = {"db": FakeDB(), "claims": {"uid": "borrower1", "role": "borrower"}}
    monkeypatch.setattr(support_requests, "db", lambda: state["db"])
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: state["claims"])
    return state


def send(body=None):
    return client.post("/core/support-requests", json=REQUEST if body is None else body, headers=TOKEN)


def only_stored(fake):
    assert len(fake["db"].store) == 1
    return next(iter(fake["db"].store.items()))


# AC1: a request stores borrower id, category, subject, message, reference and time


def test_a_request_is_stored_and_comes_back_with_its_reference(fake):
    r = send()
    assert r.status_code == 201, r.json()
    body = r.json()
    assert REFERENCE.match(body["reference"])
    assert body["category"] == "payment" and body["subject"] == REQUEST["subject"] and body["message"] == REQUEST["message"]
    assert body["application_id"] is None
    assert body["status"] == "open" and body["created_at"] == "2026-11-16T09:30:00.250Z"


def test_it_is_stored_under_its_reference_with_the_borrower_id(fake):
    reference = send().json()["reference"]
    doc_id, doc = only_stored(fake)
    assert doc_id == reference
    assert doc == {
        "userId": "borrower1", "category": "payment", "subject": REQUEST["subject"],
        "message": REQUEST["message"], "applicationId": None, "status": "open", "createdAt": NOW,
    }


def test_the_borrower_id_comes_from_the_token_not_the_body(fake):
    send({**REQUEST, "userId": "someone-else", "status": "closed", "reference": "SR-FAKE0000", "createdAt": "x"})
    doc_id, doc = only_stored(fake)
    assert doc["userId"] == "borrower1" and doc["status"] == "open" and doc_id != "SR-FAKE0000"


def test_text_is_trimmed(fake):
    send({"category": "other", "subject": "  Hello  ", "message": "  Hi there \n"})
    assert only_stored(fake)[1]["subject"] == "Hello" and only_stored(fake)[1]["message"] == "Hi there"


# AC3: the reference is unique per request


def test_each_request_gets_its_own_reference(fake):
    refs = {send().json()["reference"] for _ in range(20)}
    assert len(refs) == 20 and len(fake["db"].store) == 20


def test_a_reference_that_already_exists_is_never_overwritten(fake, monkeypatch):
    fake["db"].store["SR-AAAAAAAA"] = {"userId": "other", "subject": "keep me"}
    picks = iter(["SR-AAAAAAAA", "SR-BBBBBBBB"])
    monkeypatch.setattr(support_requests, "new_reference", lambda: next(picks))
    r = send()
    assert r.status_code == 201 and r.json()["reference"] == "SR-BBBBBBBB"
    assert fake["db"].store["SR-AAAAAAAA"] == {"userId": "other", "subject": "keep me"}


def test_it_gives_up_after_a_few_clashes(fake, monkeypatch):
    fake["db"].store["SR-AAAAAAAA"] = {"userId": "other"}
    monkeypatch.setattr(support_requests, "new_reference", lambda: "SR-AAAAAAAA")
    r = send()
    assert r.status_code == 503
    assert fake["db"].store == {"SR-AAAAAAAA": {"userId": "other"}}


def test_references_use_only_readable_characters():
    for _ in range(200):
        assert REFERENCE.match(support_requests.new_reference())


# Validation: category list, required fields, limits


@pytest.mark.parametrize("category", ["application", "payment", "account", "other"])
def test_every_listed_category_is_accepted(fake, category):
    assert send({**REQUEST, "category": category}).status_code == 201


@pytest.mark.parametrize(
    "changes,field",
    [
        ({"category": "billing"}, "category"),
        ({"category": "Payment"}, "category"),
        ({"category": None}, "category"),
        ({"subject": ""}, "subject"),
        ({"subject": "   "}, "subject"),
        ({"subject": "x" * 101}, "subject"),
        ({"subject": 5}, "subject"),
        ({"message": ""}, "message"),
        ({"message": " \n "}, "message"),
        ({"message": "x" * 2001}, "message"),
    ],
)
def test_a_bad_field_is_a_422_naming_it_and_nothing_is_saved(fake, changes, field):
    r = send({**REQUEST, **changes})
    assert r.status_code == 422 and r.json()["error"]["field"] == field
    assert fake["db"].store == {}


@pytest.mark.parametrize("field", ["category", "subject", "message"])
def test_every_field_is_required(fake, field):
    body = {k: v for k, v in REQUEST.items() if k != field}
    r = send(body)
    assert r.status_code == 422 and r.json()["error"]["field"] == field


def test_the_longest_allowed_text_is_accepted(fake):
    assert send({**REQUEST, "subject": "x" * 100, "message": "y" * 2000}).status_code == 201


# The optional application reference (Figma "Include my application reference")


def test_a_request_can_name_the_borrowers_own_application(fake):
    r = send({**REQUEST, "application_id": "app1"})
    assert r.status_code == 201, r.json()
    assert r.json()["application_id"] == "app1"
    assert only_stored(fake)[1]["applicationId"] == "app1"


def test_the_application_is_optional_and_null_means_none(fake):
    assert send({**REQUEST, "application_id": None}).json()["application_id"] is None
    assert send().json()["application_id"] is None


@pytest.mark.parametrize("application_id", ["app2", "no-such-application", "..", "__name__"])
def test_someone_elses_or_an_unknown_application_is_a_404_and_nothing_is_saved(fake, application_id):
    r = send({**REQUEST, "application_id": application_id})
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert fake["db"].store == {}


@pytest.mark.parametrize("application_id", ["", 5, ["app1"]])
def test_a_bad_application_id_is_a_422_naming_the_field(fake, application_id):
    r = send({**REQUEST, "application_id": application_id})
    assert r.status_code == 422 and r.json()["error"]["field"] == "application_id"
    assert fake["db"].store == {}


# Who may send


def test_only_a_borrower_can_send(fake):
    for role in ("broker", "underwriter"):
        fake["claims"] = {"uid": "u1", "role": role}
        assert send().status_code == 403
    assert fake["db"].store == {}


def test_no_token_is_a_401(fake):
    assert client.post("/core/support-requests", json=REQUEST).status_code == 401
