"""POST and GET /core/me against an in-memory Firestore and a stubbed token check.

The real emulator run is scripts/smoke_me.py; these tests pin down each acceptance criterion.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import AlreadyExists
from google.cloud.firestore import SERVER_TIMESTAMP

from app import auth, me
from app.main import app

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
NOW = datetime(2026, 10, 12, 20, 0, 0, 123000, tzinfo=timezone.utc)

VALID = {
    "full_name": "Aoife Byrne",
    "email": "Aoife.Byrne@Example.ie",
    "phone": "+353871234567",
    "address_line_1": "12 Lough Road",
    "county": "Cork",
    "eircode": "T12 X5R2",
}


class FakeSnap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data else None


class FakeDoc:
    def __init__(self, store, key):
        self.store, self.key = store, key

    def create(self, data):
        if self.key in self.store:
            raise AlreadyExists("exists")
        self.store[self.key] = {k: (NOW if v is SERVER_TIMESTAMP else v) for k, v in data.items()}

    def get(self):
        return FakeSnap(self.store.get(self.key))


class FakeDB:
    def __init__(self):
        self.store = {}

    def collection(self, name):
        db = self

        class Col:
            def document(self, doc_id):
                return FakeDoc(db.store, f"{name}/{doc_id}")

        return Col()


@pytest.fixture
def fake(monkeypatch):
    """In-memory Firestore, a signed-in new user with no role yet, and a record of claims set."""
    state = {"db": FakeDB(), "claims": {"uid": "new1", "email": "aoife.byrne@example.ie"}, "set_claims": []}
    monkeypatch.setattr(me, "db", lambda: state["db"])
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: state["claims"])
    monkeypatch.setattr(me.fb_auth, "set_custom_user_claims", lambda uid, c: state["set_claims"].append((uid, c)))
    return state


def post(body, **kw):
    return client.post("/core/me", json=body, headers=TOKEN, **kw)


# AC1: writes the fields in camelCase with createdAt


def test_first_call_creates_the_profile_and_returns_201(fake):
    r = post(VALID)
    assert r.status_code == 201
    assert r.json() == {
        "uid": "new1",
        "role": "borrower",
        "full_name": "Aoife Byrne",
        "email": "aoife.byrne@example.ie",
        "phone": "+353871234567",
        "address_line_1": "12 Lough Road",
        "address_line_2": None,
        "county": "Cork",
        "eircode": "T12 X5R2",
        "broker_id": None,
        "broker_name": None,
        "broker_firm": None,
        "created_at": "2026-10-12T20:00:00.123Z",
    }


def test_firestore_doc_is_camel_case_and_leaves_out_an_empty_address_line_2(fake):
    post({**VALID, "address_line_2": ""})
    assert fake["db"].store["users/new1"] == {
        "uid": "new1",
        "role": "borrower",
        "fullName": "Aoife Byrne",
        "email": "aoife.byrne@example.ie",
        "phone": "+353871234567",
        "addressLine1": "12 Lough Road",
        "county": "Cork",
        "eircode": "T12 X5R2",
        "createdAt": NOW,
    }


def test_address_line_2_is_stored_when_given(fake):
    r = post({**VALID, "address_line_2": "Ballintemple"})
    assert r.json()["address_line_2"] == "Ballintemple"
    assert fake["db"].store["users/new1"]["addressLine2"] == "Ballintemple"


# AC2: the role claim, never from the body


def test_sets_the_borrower_role_claim(fake):
    post(VALID)
    assert fake["set_claims"] == [("new1", {"role": "borrower"})]


def test_a_role_in_the_body_is_ignored(fake):
    r = post({**VALID, "role": "underwriter"})
    assert r.status_code == 201 and r.json()["role"] == "borrower"
    assert fake["set_claims"] == [("new1", {"role": "borrower"})]


def test_a_broker_or_underwriter_cannot_sign_up_as_a_borrower(fake):
    fake["claims"] = {"uid": "broker1", "role": "broker"}
    r = post(VALID)
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert "users/broker1" not in fake["db"].store and fake["set_claims"] == []


# AC3: 422 names the field


@pytest.mark.parametrize(
    "field, value",
    [
        ("phone", "0871234567"),
        ("phone", "+44 7700 900123"),
        ("phone", "+353 87"),
        ("eircode", "t12 x5r2"),
        ("eircode", "T12X5R2"),
        ("eircode", "T12 X5R"),
        ("email", "not-an-email"),
        ("full_name", ""),
        ("address_line_1", "   "),
        ("county", ""),
    ],
)
def test_invalid_value_is_422_naming_the_field(fake, field, value):
    r = post({**VALID, field: value})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "INVALID_FIELD" and err["field"] == field
    assert fake["db"].store == {} and fake["set_claims"] == []


@pytest.mark.parametrize("field", ["full_name", "email", "phone", "address_line_1", "county", "eircode"])
def test_missing_required_field_is_422_naming_it(fake, field):
    body = {k: v for k, v in VALID.items() if k != field}
    r = post(body)
    assert r.status_code == 422 and r.json()["error"]["field"] == field


def test_phone_message_says_plus_353_and_eircode_message_gives_the_example(fake):
    assert "+353" in post({**VALID, "phone": "0871234567"}).json()["error"]["message"]
    assert '"A65 F4E2"' in post({**VALID, "eircode": "a65 f4e2"}).json()["error"]["message"]


def test_email_is_stored_in_lower_case_and_phone_spaces_are_removed(fake):
    fake["claims"]["email"] = "Mixed.Case@example.ie"  # the token's case doesn't matter either
    post({**VALID, "email": "MIXED.Case@Example.IE", "phone": "+353 87 123 4567"})
    doc = fake["db"].store["users/new1"]
    assert doc["email"] == "mixed.case@example.ie" and doc["phone"] == "+353871234567"


def test_email_different_from_the_signed_in_one_is_422_naming_email(fake):
    r = post({**VALID, "email": "someone.else@example.ie"})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "INVALID_FIELD" and err["field"] == "email"
    assert "signed in with" in err["message"]
    assert fake["db"].store == {} and fake["set_claims"] == []


def test_email_mismatch_is_rejected_on_a_repeat_call_too(fake):
    post(VALID)
    r = post({**VALID, "email": "someone.else@example.ie"})
    assert r.status_code == 422 and r.json()["error"]["field"] == "email"
    assert fake["db"].store["users/new1"]["email"] == "aoife.byrne@example.ie"


def test_eircode_with_d6w_routing_key_is_accepted(fake):
    assert post({**VALID, "eircode": "D6W XY12"}).status_code == 201


# AC4: repeat calls return 200 with the same profile, never a duplicate


def test_repeat_call_returns_200_with_the_existing_profile_unchanged(fake):
    first = post(VALID)
    fake["claims"] = {"uid": "new1", "role": "borrower"}  # the app refreshed its token
    again = post({**VALID, "full_name": "Someone Else"})
    assert again.status_code == 200 and again.json() == first.json()
    assert len(fake["db"].store) == 1
    assert fake["set_claims"] == [("new1", {"role": "borrower"})]  # not set a second time


def test_repeat_call_before_the_token_refresh_sets_the_claim_again(fake):
    post(VALID)
    r = post(VALID)  # token still has no role claim
    assert r.status_code == 200 and len(fake["db"].store) == 1


# AC5: GET


def test_get_returns_the_callers_profile(fake):
    created = post(VALID).json()
    r = client.get("/core/me", headers=TOKEN)
    assert r.status_code == 200 and r.json() == created


def test_get_without_a_profile_is_404(fake):
    r = client.get("/core/me", headers=TOKEN)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_get_and_post_need_a_token():
    assert client.get("/core/me").status_code == 401
    assert client.post("/core/me", json=VALID).status_code == 401


# AC7: Google sign-in users


def test_google_sign_in_user_can_sign_up(fake):
    fake["claims"] = {
        "uid": "google1",
        "email": "aoife@gmail.com",
        "firebase": {"sign_in_provider": "google.com"},
    }
    r = post({**VALID, "email": "aoife@gmail.com"})
    assert r.status_code == 201 and r.json()["uid"] == "google1"
    assert fake["set_claims"] == [("google1", {"role": "borrower"})]


def test_every_response_has_a_request_id(fake):
    assert post(VALID).headers["X-Request-ID"]
    assert client.get("/core/me", headers=TOKEN).headers["X-Request-ID"]
