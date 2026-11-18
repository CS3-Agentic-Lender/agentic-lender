"""PUT /core/reviews/me against an in-memory Firestore (AL-74)."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from google.cloud.firestore import SERVER_TIMESTAMP

from app import auth, reviews
from app.main import app

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
T1 = datetime(2026, 11, 17, 9, 0, 0, 100000, tzinfo=timezone.utc)
T2 = datetime(2026, 11, 18, 10, 0, 0, 200000, tzinfo=timezone.utc)


class FakeSnap:
    def __init__(self, data):
        self._data, self.exists = data, data is not None

    def to_dict(self):
        return dict(self._data) if self._data else None


class FakeDoc:
    def __init__(self, db, doc_id):
        self.db, self.id = db, doc_id

    def get(self):
        return FakeSnap(self.db.store.get(self.id))

    def set(self, data):
        self.db.store[self.id] = {k: (self.db.now if v is SERVER_TIMESTAMP else v) for k, v in data.items()}


class FakeDB:
    def __init__(self):
        self.store, self.now = {}, T1

    def collection(self, name):
        assert name == "reviews"
        return self

    def document(self, doc_id):
        return FakeDoc(self, doc_id)


@pytest.fixture
def fake(monkeypatch):
    """In-memory Firestore, signed in as the borrower with uid borrower1."""
    state = {"db": FakeDB(), "claims": {"uid": "borrower1", "role": "borrower"}}
    monkeypatch.setattr(reviews, "db", lambda: state["db"])
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: state["claims"])
    return state


def put(body):
    return client.put("/core/reviews/me", json=body, headers=TOKEN)


# AC1: one review per borrower, document id = the borrower's id, stars, optional comment, time


def test_a_review_is_saved_under_the_borrowers_id_and_comes_back(fake):
    r = put({"rating": 4, "comment": "Clear and quick."})
    assert r.status_code == 200, r.json()
    assert r.json() == {
        "rating": 4, "comment": "Clear and quick.",
        "created_at": "2026-11-17T09:00:00.100Z", "updated_at": "2026-11-17T09:00:00.100Z",
    }
    assert fake["db"].store == {
        "borrower1": {"userId": "borrower1", "rating": 4, "comment": "Clear and quick.", "createdAt": T1, "updatedAt": T1}
    }


def test_the_comment_is_optional(fake):
    for body in ({"rating": 5}, {"rating": 5, "comment": None}):
        fake["db"].store.clear()
        r = put(body)
        assert r.status_code == 200 and r.json()["comment"] is None
        assert fake["db"].store["borrower1"]["comment"] is None


def test_a_blank_comment_means_no_comment(fake):
    assert put({"rating": 3, "comment": "   \n "}).json()["comment"] is None


def test_the_comment_is_trimmed(fake):
    assert put({"rating": 3, "comment": "  fine  "}).json()["comment"] == "fine"


def test_the_borrower_id_comes_from_the_token_not_the_body(fake):
    put({"rating": 2, "user_id": "someone-else", "userId": "someone-else"})
    assert list(fake["db"].store) == ["borrower1"]
    assert fake["db"].store["borrower1"]["userId"] == "borrower1"


def test_each_borrower_has_their_own_review(fake):
    put({"rating": 5})
    fake["claims"] = {"uid": "borrower2", "role": "borrower"}
    put({"rating": 1})
    assert {k: v["rating"] for k, v in fake["db"].store.items()} == {"borrower1": 5, "borrower2": 1}


# AC3: writing again replaces the borrower's own review


def test_writing_again_replaces_it_and_keeps_the_first_time(fake):
    put({"rating": 2, "comment": "Slow."})
    fake["db"].now = T2
    r = put({"rating": 5})
    assert r.status_code == 200
    assert r.json() == {"rating": 5, "comment": None, "created_at": "2026-11-17T09:00:00.100Z", "updated_at": "2026-11-18T10:00:00.200Z"}
    assert list(fake["db"].store) == ["borrower1"]


# AC2 (the API side): stars 1 to 5, comment up to 500 characters


@pytest.mark.parametrize("rating", [1, 2, 3, 4, 5])
def test_every_star_count_from_1_to_5_is_accepted(fake, rating):
    assert put({"rating": rating}).json()["rating"] == rating


@pytest.mark.parametrize("rating", [0, 6, -1, 100, 4.5, 4.0, "5", True, None])
def test_a_rating_outside_1_to_5_or_not_a_whole_number_is_a_422_and_nothing_is_saved(fake, rating):
    r = put({"rating": rating})
    assert r.status_code == 422 and r.json()["error"]["field"] == "rating"
    assert fake["db"].store == {}


def test_the_rating_is_required(fake):
    r = put({"comment": "no stars"})
    assert r.status_code == 422 and r.json()["error"]["field"] == "rating"


def test_a_comment_of_500_characters_is_accepted_and_501_is_not(fake):
    assert put({"rating": 3, "comment": "x" * 500}).status_code == 200
    r = put({"rating": 3, "comment": "x" * 501})
    assert r.status_code == 422 and r.json()["error"]["field"] == "comment"


def test_a_refused_review_does_not_replace_the_old_one(fake):
    put({"rating": 4, "comment": "Good."})
    assert put({"rating": 9}).status_code == 422
    assert fake["db"].store["borrower1"]["rating"] == 4


# Who may write


def test_only_a_borrower_can_review(fake):
    for role in ("broker", "underwriter"):
        fake["claims"] = {"uid": "u1", "role": role}
        assert put({"rating": 5}).status_code == 403
    assert fake["db"].store == {}


def test_no_token_is_a_401(fake):
    assert client.put("/core/reviews/me", json={"rating": 5}).status_code == 401


def test_there_is_no_way_to_write_another_borrowers_review(fake):
    assert client.put("/core/reviews/borrower2", json={"rating": 1}, headers=TOKEN).status_code in (404, 405)
    assert fake["db"].store == {}
