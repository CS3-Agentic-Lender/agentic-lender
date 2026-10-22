"""GET /core/brokers, PUT /core/me/broker and the broker's name and firm on GET /core/me."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import auth, me
from app.main import app

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
CREATED = datetime(2026, 9, 20, 9, 0, tzinfo=timezone.utc)

USERS = {
    "borrower1": {"uid": "borrower1", "role": "borrower", "fullName": "Alice Byrne", "email": "alice@test.com",
                  "brokerId": "broker1", "createdAt": CREATED},
    "borrower3": {"uid": "borrower3", "role": "borrower", "fullName": "Cara Doyle", "email": "cara@test.com",
                  "createdAt": CREATED},
    "broker1": {"uid": "broker1", "role": "broker", "fullName": "Bob Murphy", "firm": "Murphy Mortgages"},
    "broker2": {"uid": "broker2", "role": "broker", "fullName": "Ciara Kelly", "firm": "Kelly Financial"},
    "broker3": {"uid": "broker3", "role": "broker", "fullName": "aidan Walsh"},  # no firm, lower-case name
    "underwriter1": {"uid": "underwriter1", "role": "underwriter", "fullName": "Uma Nolan"},
}


class FakeSnap:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data else None


class FakeDoc:
    def __init__(self, store, doc_id):
        self.store, self.id = store, doc_id

    def get(self):
        return FakeSnap(self.id, self.store.get(self.id))

    def update(self, changes):
        self.store[self.id].update(changes)


class FakeUsers:
    def __init__(self, store):
        self.store = store

    def document(self, doc_id):
        return FakeDoc(self.store, doc_id)

    def where(self, filter):
        store = self.store

        class Query:
            def stream(self):
                for doc_id, doc in store.items():
                    if doc.get(filter.field_path) == filter.value:
                        yield FakeSnap(doc_id, doc)

        return Query()


class FakeDB:
    def __init__(self):
        self.users = {k: dict(v) for k, v in USERS.items()}

    def collection(self, name):
        assert name == "users"
        return FakeUsers(self.users)


@pytest.fixture
def fake(monkeypatch):
    state = {"db": FakeDB(), "claims": {"uid": "borrower1", "role": "borrower"}}
    monkeypatch.setattr(me, "db", lambda: state["db"])
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: state["claims"])
    return state


def sign_in(fake, uid, role):
    fake["claims"] = {"uid": uid, "role": role}


def choose(broker_id):
    return client.put("/core/me/broker", json={"broker_id": broker_id}, headers=TOKEN)


# GET /core/brokers


def test_lists_every_broker_with_name_and_firm_sorted_by_name(fake):
    r = client.get("/core/brokers", headers=TOKEN)
    assert r.status_code == 200
    assert r.json() == [
        {"uid": "broker3", "name": "aidan Walsh", "firm": None},
        {"uid": "broker1", "name": "Bob Murphy", "firm": "Murphy Mortgages"},
        {"uid": "broker2", "name": "Ciara Kelly", "firm": "Kelly Financial"},
    ]


def test_list_holds_only_name_and_firm_never_contact_details(fake):
    fake["db"].users["broker1"].update({"email": "bob@test.com", "phone": "+353871234511"})
    for broker in client.get("/core/brokers", headers=TOKEN).json():
        assert set(broker) == {"uid", "name", "firm"}


def test_a_signed_in_user_without_a_role_yet_can_list_brokers(fake):
    fake["claims"] = {"uid": "new1"}
    assert client.get("/core/brokers", headers=TOKEN).status_code == 200


def test_listing_brokers_needs_a_token():
    assert client.get("/core/brokers").status_code == 401


# PUT /core/me/broker


def test_a_borrower_chooses_a_broker(fake):
    sign_in(fake, "borrower3", "borrower")
    r = choose("broker2")
    assert r.status_code == 200
    body = r.json()
    assert body["broker_id"] == "broker2"
    assert body["broker_name"] == "Ciara Kelly" and body["broker_firm"] == "Kelly Financial"
    assert fake["db"].users["borrower3"]["brokerId"] == "broker2"


def test_a_borrower_changes_broker(fake):
    r = choose("broker2")
    assert r.status_code == 200 and r.json()["broker_id"] == "broker2"
    assert fake["db"].users["borrower1"]["brokerId"] == "broker2"


def test_choosing_the_same_broker_again_is_fine(fake):
    assert choose("broker1").status_code == 200


def test_only_the_broker_field_changes(fake):
    before = dict(fake["db"].users["borrower1"])
    choose("broker2")
    after = fake["db"].users["borrower1"]
    assert {k: v for k, v in after.items() if k != "brokerId"} == {k: v for k, v in before.items() if k != "brokerId"}


@pytest.mark.parametrize("broker_id", ["nobody", "underwriter1", "borrower3"])
def test_a_uid_that_is_not_a_broker_is_422_naming_broker_id(fake, broker_id):
    r = choose(broker_id)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "INVALID_FIELD" and err["field"] == "broker_id" and "not a broker" in err["message"]
    assert fake["db"].users["borrower1"]["brokerId"] == "broker1"


@pytest.mark.parametrize("body", [{}, {"broker_id": ""}, {"broker_id": "   "}])
def test_a_missing_or_blank_broker_id_is_422(fake, body):
    r = client.put("/core/me/broker", json=body, headers=TOKEN)
    assert r.status_code == 422 and r.json()["error"]["field"] == "broker_id"


def test_no_profile_yet_is_404(fake):
    sign_in(fake, "ghost", "borrower")
    r = choose("broker1")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize("role", ["broker", "underwriter"])
def test_only_borrowers_can_choose_a_broker(fake, role):
    sign_in(fake, "broker1", role)
    assert choose("broker2").status_code == 403


def test_choosing_needs_a_token():
    assert client.put("/core/me/broker", json={"broker_id": "broker1"}).status_code == 401


# GET /core/me shows the broker's name and firm


def test_get_me_includes_the_brokers_name_and_firm(fake):
    r = client.get("/core/me", headers=TOKEN)
    assert r.status_code == 200
    body = r.json()
    assert body["broker_id"] == "broker1"
    assert body["broker_name"] == "Bob Murphy" and body["broker_firm"] == "Murphy Mortgages"


def test_get_me_without_a_broker_has_nulls(fake):
    sign_in(fake, "borrower3", "borrower")
    body = client.get("/core/me", headers=TOKEN).json()
    assert body["broker_id"] is None and body["broker_name"] is None and body["broker_firm"] is None


def test_a_broker_without_a_firm_shows_null_firm(fake):
    choose("broker3")
    body = client.get("/core/me", headers=TOKEN).json()
    assert body["broker_name"] == "aidan Walsh" and body["broker_firm"] is None


def test_a_broker_id_pointing_at_a_missing_user_shows_nulls(fake):
    fake["db"].users["borrower1"]["brokerId"] = "deleted-broker"
    body = client.get("/core/me", headers=TOKEN).json()
    assert body["broker_id"] == "deleted-broker" and body["broker_name"] is None
