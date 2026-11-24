"""The staff accounts API (/core/admin/staff) against an in-memory Firestore and a fake Firebase Auth."""

from datetime import datetime, timezone
import itertools
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from firebase_admin import auth as fb_auth
from google.cloud.firestore import DELETE_FIELD, SERVER_TIMESTAMP

from app import admin, auth, me
from app.main import app

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
CREATED = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)
NOW = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)

PROFILES = {
    "admin1": {"uid": "admin1", "role": "admin", "fullName": "Ada Byrne", "email": "admin@test.com",
               "phone": "+353871234531", "createdAt": CREATED},
    "broker1": {"uid": "broker1", "role": "broker", "fullName": "Bob Murphy", "email": "bob@test.com",
                "phone": "+353871234511", "firm": "Murphy Mortgages", "createdAt": CREATED},
    "broker2": {"uid": "broker2", "role": "broker", "fullName": "Ciara Kelly", "email": "ciara@test.com",
                "phone": "+353871234512", "firm": "Kelly Financial", "createdAt": CREATED},
    "underwriter1": {"uid": "underwriter1", "role": "underwriter", "fullName": "Uma Nolan", "email": "uma@test.com",
                     "phone": "+353871234521", "createdAt": CREATED},
    "underwriter2": {"uid": "underwriter2", "role": "underwriter", "fullName": "Vera Quinn", "email": "vera@test.com",
                     "phone": "+353871234522", "createdAt": CREATED},
    "borrower1": {"uid": "borrower1", "role": "borrower", "fullName": "Alice Byrne", "email": "alice@test.com",
                  "phone": "+353871234501", "addressLine1": "12 Lough Road", "county": "Cork", "eircode": "T12 X5R2",
                  "brokerId": "broker1", "createdAt": CREATED},
}


def value_at(doc, dotted):
    for part in dotted.split("."):
        if not isinstance(doc, dict) or part not in doc:
            return None
        doc = doc[part]
    return doc


def resolve(value):
    return NOW if value is SERVER_TIMESTAMP else value


class FakeSnap:
    def __init__(self, doc_id, data):
        self.id, self._data, self.exists = doc_id, data, data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class FakeDoc:
    def __init__(self, db, path):
        self.db, self.path, self.id = db, path, path.split("/")[-1]

    def get(self):
        return FakeSnap(self.id, self.db.store.get(self.path))


class FakeQuery:
    def __init__(self, db, collection, filters=(), limit=None):
        self.db, self.collection, self.filters, self.n = db, collection, filters, limit

    def where(self, filter):
        return FakeQuery(self.db, self.collection, self.filters + (filter,), self.n)

    def limit(self, n):
        return FakeQuery(self.db, self.collection, self.filters, n)

    def _matches(self, doc):
        for f in self.filters:
            value = value_at(doc, f.field_path)
            if f.op_string == "==" and value != f.value:
                return False
            if f.op_string == "in" and value not in f.value:
                return False
        return True

    def stream(self):
        self.db.queries.append((self.collection, tuple((f.field_path, f.op_string, f.value) for f in self.filters), self.n))
        found = [
            FakeSnap(path.split("/")[1], doc)
            for path, doc in sorted(self.db.store.items())
            if path.count("/") == 1 and path.startswith(f"{self.collection}/") and self._matches(doc)
        ]
        return iter(found[: self.n] if self.n else found)


class FakeCollection(FakeQuery):
    def document(self, doc_id=None):
        return FakeDoc(self.db, f"{self.collection}/{doc_id or next(self.db.ids)}")


class FakeBatch:
    def __init__(self, db):
        self.db, self.ops = db, []

    def create(self, ref, data):
        self.ops.append(("create", ref.path, data))

    def update(self, ref, data):
        self.ops.append(("update", ref.path, data))

    def delete(self, ref):
        self.ops.append(("delete", ref.path, None))

    def commit(self):
        if self.db.fail_commit:
            raise RuntimeError("Firestore is down")
        for op, path, data in self.ops:
            store = self.db.store
            if op == "create":
                assert path not in store
                store[path] = {k: resolve(v) for k, v in data.items()}
            elif op == "update":
                doc = store[path]
                for key, value in data.items():
                    if value is DELETE_FIELD:
                        doc.pop(key, None)
                    else:
                        doc[key] = resolve(value)
            else:
                store.pop(path, None)


class FakeDB:
    def __init__(self):
        self.store = {f"users/{uid}": dict(p) for uid, p in PROFILES.items()}
        self.ids = (f"id{n}" for n in itertools.count(1))
        self.queries = []
        self.fail_commit = False

    def collection(self, name):
        return FakeCollection(self, name)

    def batch(self):
        return FakeBatch(self)


class FakeAuth:
    """Just the Admin SDK calls the staff API makes. Users are uid -> SimpleNamespace(email, disabled, claims)."""

    def __init__(self):
        self.users = {
            uid: SimpleNamespace(uid=uid, email=p["email"], disabled=False, custom_claims={"role": p["role"]},
                                 display_name=p["fullName"], email_verified=True, password_hash=None)
            for uid, p in PROFILES.items()
        }
        self.revoked = []
        self.created_kwargs = []
        self.ids = (f"new{n}" for n in itertools.count(1))

    def _get(self, uid):
        if uid not in self.users:
            raise fb_auth.UserNotFoundError(f"No user record found for {uid}")
        return self.users[uid]

    def get_user(self, uid):
        return self._get(uid)

    def create_user(self, **kwargs):
        self.created_kwargs.append(kwargs)
        if any(u.email == kwargs["email"] for u in self.users.values()):
            raise fb_auth.EmailAlreadyExistsError("exists", None, None)
        uid = next(self.ids)
        self.users[uid] = SimpleNamespace(uid=uid, email=kwargs["email"], disabled=kwargs.get("disabled", False),
                                          custom_claims=None, display_name=kwargs.get("display_name"),
                                          email_verified=kwargs.get("email_verified"), password_hash=None)
        return self.users[uid]

    def set_custom_user_claims(self, uid, claims):
        self._get(uid).custom_claims = claims

    def update_user(self, uid, **kwargs):
        user = self._get(uid)
        if "disabled" in kwargs:
            user.disabled = kwargs["disabled"]
        return user

    def revoke_refresh_tokens(self, uid):
        self._get(uid)
        self.revoked.append(uid)

    def delete_user(self, uid):
        self._get(uid)
        del self.users[uid]


@pytest.fixture
def fake(monkeypatch):
    state = {"db": FakeDB(), "auth": FakeAuth(), "claims": {"uid": "admin1", "role": "admin"}}
    monkeypatch.setattr(admin, "db", lambda: state["db"])
    monkeypatch.setattr(me, "db", lambda: state["db"])
    for name in ("get_user", "create_user", "set_custom_user_claims", "update_user", "revoke_refresh_tokens", "delete_user"):
        monkeypatch.setattr(admin.fb_auth, name, getattr(state["auth"], name))
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: state["claims"])
    return state


def sign_in(fake, uid, role):
    fake["claims"] = {"uid": uid, "role": role}


def actions(fake):
    return [doc for path, doc in fake["db"].store.items() if path.startswith("admin_actions/")]


def snapshot(fake):
    """Everything the API could change, to prove a refused call changed nothing."""
    users = {uid: vars(u).copy() for uid, u in fake["auth"].users.items()}
    return {k: dict(v) for k, v in fake["db"].store.items()}, users, list(fake["auth"].revoked)


NEW_BROKER = {"full_name": "Dan Hayes", "email": "Dan@Example.com", "phone": "+353 87 123 4599", "role": "broker",
              "firm": "Hayes Home Loans"}
NEW_UNDERWRITER = {"full_name": "Eve Lynch", "email": "eve@example.com", "phone": "+353871234598", "role": "underwriter"}


def create(body):
    return client.post("/core/admin/staff", json=body, headers=TOKEN)


def patch(uid, body):
    return client.patch(f"/core/admin/staff/{uid}", json=body, headers=TOKEN)


def delete(uid):
    return client.delete(f"/core/admin/staff/{uid}", headers=TOKEN)


def add_application(fake, app_id, **fields):
    fake["db"].store[f"applications/{app_id}"] = {"borrowerId": "borrower1", "status": "Applied", **fields}


# AC1: every endpoint is admin-only


ENDPOINTS = [
    ("get", "/core/admin/staff", None),
    ("post", "/core/admin/staff", NEW_BROKER),
    ("patch", "/core/admin/staff/broker2", {"disabled": True}),
    ("delete", "/core/admin/staff/broker2", None),
]


@pytest.mark.parametrize("method,path,body", ENDPOINTS, ids=[e[0] for e in ENDPOINTS])
@pytest.mark.parametrize("uid,role", [("borrower1", "borrower"), ("broker1", "broker"), ("underwriter1", "underwriter"), ("new", None)])
def test_every_non_admin_gets_403_and_nothing_changes(fake, method, path, body, uid, role):
    fake["claims"] = {"uid": uid, "role": role} if role else {"uid": uid}
    before = snapshot(fake)
    r = client.request(method.upper(), path, json=body, headers=TOKEN)
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert snapshot(fake) == before


@pytest.mark.parametrize("method,path,body", ENDPOINTS, ids=[e[0] for e in ENDPOINTS])
def test_every_endpoint_needs_a_token(method, path, body):
    assert client.request(method.upper(), path, json=body).status_code == 401


# GET /core/admin/staff


def test_lists_every_staff_account_and_no_borrowers(fake):
    fake["db"].store["users/broker2"]["disabled"] = True
    r = client.get("/core/admin/staff", headers=TOKEN)
    assert r.status_code == 200
    staff = r.json()
    assert [s["uid"] for s in staff] == ["admin1", "broker1", "broker2", "underwriter1", "underwriter2"]
    assert staff[1] == {
        "uid": "broker1", "full_name": "Bob Murphy", "email": "bob@test.com", "role": "broker",
        "firm": "Murphy Mortgages", "phone": "+353871234511", "enabled": True, "created_at": "2026-09-01T09:00:00.000Z",
    }
    assert staff[0]["role"] == "admin" and staff[0]["firm"] is None
    assert staff[2]["enabled"] is False


# POST /core/admin/staff


def test_creates_a_broker_with_no_password_the_claim_and_a_staff_profile(fake):
    r = create(NEW_BROKER)
    assert r.status_code == 201
    assert r.json() == {
        "uid": "new1", "full_name": "Dan Hayes", "email": "dan@example.com", "role": "broker", "firm": "Hayes Home Loans",
        "phone": "+353871234599", "enabled": True, "created_at": "2026-11-24T12:00:00.000Z",
    }
    (kwargs,) = fake["auth"].created_kwargs
    assert kwargs == {"email": "dan@example.com", "display_name": "Dan Hayes", "email_verified": False}
    assert fake["auth"].users["new1"].custom_claims == {"role": "broker"}
    assert fake["db"].store["users/new1"] == {
        "uid": "new1", "role": "broker", "fullName": "Dan Hayes", "email": "dan@example.com", "phone": "+353871234599",
        "firm": "Hayes Home Loans", "disabled": False, "createdAt": NOW,
    }


def test_creates_an_underwriter_without_a_firm(fake):
    r = create({**NEW_UNDERWRITER, "firm": "Ignored Ltd"})
    assert r.status_code == 201 and r.json()["role"] == "underwriter" and r.json()["firm"] is None
    assert "firm" not in fake["db"].store["users/new1"]
    assert fake["auth"].users["new1"].custom_claims == {"role": "underwriter"}


def test_a_broker_needs_a_firm(fake):
    r = create({**NEW_BROKER, "firm": "  "})
    assert r.status_code == 422 and r.json()["error"]["field"] == "firm"
    assert "new1" not in fake["auth"].users


@pytest.mark.parametrize("role", ["admin", "borrower", "boss", ""])
def test_no_other_role_can_be_created(fake, role):
    before = snapshot(fake)
    r = create({**NEW_BROKER, "role": role})
    assert r.status_code == 400 and r.json()["error"]["code"] == "BAD_REQUEST"
    assert "broker or underwriter" in r.json()["error"]["message"]
    assert snapshot(fake) == before


def test_an_email_that_exists_is_409(fake):
    before = snapshot(fake)
    r = create({**NEW_BROKER, "email": "uma@test.com"})
    assert r.status_code == 409 and "already" in r.json()["error"]["message"]
    assert snapshot(fake) == before


@pytest.mark.parametrize("field,value", [("phone", "0871234599"), ("email", "not-an-email"), ("full_name", "")])
def test_bad_fields_are_422_naming_the_field(fake, field, value):
    r = create({**NEW_BROKER, field: value})
    assert r.status_code == 422 and r.json()["error"]["field"] == field


def test_a_failed_profile_write_removes_the_new_auth_account(fake):
    fake["db"].fail_commit = True
    r = TestClient(app, raise_server_exceptions=False).post("/core/admin/staff", json=NEW_BROKER, headers=TOKEN)
    assert r.status_code == 500
    assert "new1" not in fake["auth"].users and actions(fake) == []


# PATCH /core/admin/staff/{uid}: disable and enable


def test_disabling_blocks_sign_in_revokes_sessions_and_is_shown(fake):
    r = patch("broker2", {"disabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert fake["auth"].users["broker2"].disabled is True
    assert fake["auth"].revoked == ["broker2"]
    assert fake["db"].store["users/broker2"]["disabled"] is True


def test_enabling_undoes_it(fake):
    patch("broker2", {"disabled": True})
    r = patch("broker2", {"disabled": False})
    assert r.status_code == 200 and r.json()["enabled"] is True
    assert fake["auth"].users["broker2"].disabled is False and fake["db"].store["users/broker2"]["disabled"] is False


def test_disabling_twice_changes_nothing_the_second_time(fake):
    patch("broker2", {"disabled": True})
    before = snapshot(fake)
    r = patch("broker2", {"disabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert snapshot(fake) == before


def test_disabling_a_broker_with_clients_is_allowed(fake):
    """Disable is the way out the guards point to, so work attached never blocks it."""
    assert patch("broker1", {"disabled": True}).status_code == 200


def test_an_empty_patch_is_422(fake):
    r = patch("broker2", {})
    assert r.status_code == 422
    assert r.json()["error"] == {**r.json()["error"], "code": "INVALID_FIELD", "field": None, "message": "Send disabled, role or both"}


# PATCH: role change


def test_a_role_change_sets_the_claim_and_profile_and_revokes_sessions(fake):
    r = patch("broker2", {"role": "underwriter"})
    assert r.status_code == 200 and r.json()["role"] == "underwriter" and r.json()["firm"] is None
    assert fake["auth"].users["broker2"].custom_claims == {"role": "underwriter"}
    assert fake["db"].store["users/broker2"]["role"] == "underwriter"
    assert "firm" not in fake["db"].store["users/broker2"]
    assert fake["auth"].revoked == ["broker2"]


def test_a_change_to_broker_needs_a_firm_and_stores_it(fake):
    r = patch("underwriter2", {"role": "broker"})
    assert r.status_code == 422 and r.json()["error"]["field"] == "firm"
    r = patch("underwriter2", {"role": "broker", "firm": "Quinn Finance"})
    assert r.status_code == 200 and r.json()["firm"] == "Quinn Finance"
    assert fake["db"].store["users/underwriter2"]["firm"] == "Quinn Finance"
    assert fake["auth"].users["underwriter2"].custom_claims == {"role": "broker"}


def test_a_firm_without_a_change_to_broker_is_422(fake):
    r = patch("broker2", {"firm": "New Firm"})
    assert r.status_code == 422 and r.json()["error"]["field"] == "firm"


def test_the_same_role_again_changes_nothing(fake):
    before = snapshot(fake)
    r = patch("underwriter2", {"role": "underwriter"})
    assert r.status_code == 200
    assert snapshot(fake) == before


def test_a_role_changed_broker_leaves_the_broker_list(fake):
    patch("broker2", {"role": "underwriter"})
    sign_in(fake, "borrower1", "borrower")
    assert "broker2" not in [b["uid"] for b in client.get("/core/brokers", headers=TOKEN).json()]


@pytest.mark.parametrize("role", ["admin", "borrower", "boss"])
def test_no_one_can_be_made_an_admin_or_a_borrower(fake, role):
    before = snapshot(fake)
    r = patch("broker2", {"role": role})
    assert r.status_code == 400 and r.json()["error"]["code"] == "BAD_REQUEST"
    assert snapshot(fake) == before


# AC2: admins and borrowers are never a target


@pytest.mark.parametrize("target", ["admin1", "borrower1"])
@pytest.mark.parametrize("call", [
    lambda uid: patch(uid, {"disabled": True}),
    lambda uid: patch(uid, {"role": "underwriter"}),
    lambda uid: patch(uid, {"role": "broker", "firm": "X"}),
    lambda uid: delete(uid),
], ids=["disable", "to underwriter", "to broker", "delete"])
def test_an_admin_or_a_borrower_cannot_be_changed_or_deleted(fake, target, call):
    before = snapshot(fake)
    r = call(target)
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert snapshot(fake) == before


def test_another_admin_is_refused_too(fake):
    fake["db"].store["users/admin2"] = {**PROFILES["admin1"], "uid": "admin2", "email": "admin2@test.com"}
    fake["auth"].users["admin2"] = SimpleNamespace(uid="admin2", email="admin2@test.com", disabled=False,
                                                   custom_claims={"role": "admin"})
    assert patch("admin2", {"disabled": True}).status_code == 403
    assert delete("admin2").status_code == 403


def test_the_claim_decides_not_the_profile(fake):
    """A profile that says broker on an account whose claim is admin is still an admin."""
    fake["db"].store["users/admin1"]["role"] = "broker"
    assert delete("admin1").status_code == 403


@pytest.mark.parametrize("call", [lambda: patch("ghost", {"disabled": True}), lambda: delete("ghost")])
def test_an_unknown_uid_is_404(fake, call):
    assert call().status_code == 404


# AC3: work-attached guards


def test_a_broker_with_borrowers_cannot_be_deleted_or_moved(fake):
    before = snapshot(fake)
    for r in (delete("broker1"), patch("broker1", {"role": "underwriter"})):
        assert r.status_code == 409
        assert r.json()["error"]["message"] == (
            "Bob Murphy still has borrowers or applications. Disable the account instead.")
    assert snapshot(fake) == before


def test_a_broker_with_applications_but_no_borrowers_left_is_refused(fake):
    add_application(fake, "app9", brokerId="broker2")
    before = snapshot(fake)
    assert delete("broker2").status_code == 409
    assert patch("broker2", {"role": "underwriter"}).status_code == 409
    assert snapshot(fake) == before


def test_an_underwriter_with_sign_offs_cannot_be_deleted_or_moved(fake):
    add_application(fake, "app9", brokerId="broker2", status="Declined",
                    decision={"outcome": "declined", "underwriterId": "underwriter1", "decidedAt": CREATED})
    before = snapshot(fake)
    for r in (delete("underwriter1"), patch("underwriter1", {"role": "broker", "firm": "X"})):
        assert r.status_code == 409
        assert r.json()["error"]["message"] == "Uma Nolan has signed off applications. Disable the account instead."
    assert snapshot(fake) == before


def test_the_guards_query_one_document_each(fake):
    delete("underwriter2")
    assert ("applications", (("decision.underwriterId", "==", "underwriter2"),), 1) in fake["db"].queries
    delete("broker2")
    assert ("users", (("brokerId", "==", "broker2"),), 1) in fake["db"].queries
    assert ("applications", (("brokerId", "==", "broker2"),), 1) in fake["db"].queries


# DELETE /core/admin/staff/{uid}


def test_deleting_an_account_with_nothing_attached_removes_it(fake):
    r = delete("underwriter2")
    assert r.status_code == 200 and r.json() == {"deleted": "underwriter2"}
    assert "underwriter2" not in fake["auth"].users and "users/underwriter2" not in fake["db"].store


def test_a_delete_that_lost_its_auth_account_finishes_on_retry(fake):
    del fake["auth"].users["underwriter2"]
    r = delete("underwriter2")
    assert r.status_code == 200 and "users/underwriter2" not in fake["db"].store
    assert delete("underwriter2").status_code == 404


# AC5: every successful action writes one admin_actions record


def test_each_successful_action_writes_one_record(fake):
    create(NEW_BROKER)
    patch("broker2", {"disabled": True})
    patch("broker2", {"disabled": False})
    patch("underwriter2", {"role": "broker", "firm": "Quinn Finance"})
    delete("new1")
    records = sorted(actions(fake), key=lambda a: a["action"])
    assert [a["action"] for a in records] == ["change_role", "create_staff", "delete_staff", "disable_staff", "enable_staff"]
    assert all(a["actorUid"] == "admin1" and a["createdAt"] == NOW for a in records)
    by_action = {a["action"]: a for a in records}
    assert by_action["create_staff"]["targetUid"] == "new1"
    assert by_action["create_staff"]["details"] == {"role": "broker", "email": "dan@example.com"}
    assert by_action["change_role"] == {
        "actorUid": "admin1", "action": "change_role", "targetUid": "underwriter2",
        "details": {"from": "underwriter", "to": "broker"}, "createdAt": NOW,
    }
    assert by_action["delete_staff"]["details"] == {"role": "broker", "email": "dan@example.com", "fullName": "Dan Hayes"}


def test_refused_and_no_op_calls_write_no_record(fake):
    create({**NEW_BROKER, "role": "admin"})
    create({**NEW_BROKER, "email": "uma@test.com"})
    delete("broker1")
    delete("admin1")
    patch("underwriter2", {"role": "underwriter"})
    assert actions(fake) == []


def test_disable_and_role_change_in_one_call_write_two_records(fake):
    r = patch("underwriter2", {"disabled": True, "role": "broker", "firm": "Quinn Finance"})
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["role"] == "broker"
    assert sorted(a["action"] for a in actions(fake)) == ["change_role", "disable_staff"]


# Disabled brokers and the borrower's broker picker (me.py)


def test_a_disabled_broker_is_not_listed_or_choosable(fake):
    patch("broker2", {"disabled": True})
    sign_in(fake, "borrower1", "borrower")
    assert "broker2" not in [b["uid"] for b in client.get("/core/brokers", headers=TOKEN).json()]
    r = client.put("/core/me/broker", json={"broker_id": "broker2"}, headers=TOKEN)
    assert r.status_code == 422 and r.json()["error"]["field"] == "broker_id"
    assert fake["db"].store["users/borrower1"]["brokerId"] == "broker1"
