"""The status move table: every allowed move for its actor, and what is refused."""

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from google.cloud.firestore import SERVER_TIMESTAMP, ArrayUnion

from app import status

AT = datetime(2026, 10, 29, 12, 0, 0, tzinfo=timezone.utc)
ACTORS = (status.BORROWER, status.COMMITTEE, status.UNDERWRITER, status.MINT)

ALLOWED = [
    ("Draft", "Applied", "borrower"),
    ("Applied", "AI Deliberated", "committee"),
    ("AI Deliberated", "Underwriter Approved", "underwriter"),
    ("AI Deliberated", "Declined", "underwriter"),
    ("Underwriter Approved", "Funded", "mint"),
    ("Funded", "Closed", "underwriter"),
    ("Declined", "Closed", "underwriter"),
]


def move(current, new, actor, extra=None):
    return status.plan_move({"status": current}, new, actor, "someone", extra=extra, now=AT)


def test_the_table_is_exactly_the_agreed_moves():
    assert {(a, b): who for a, b, who in ALLOWED} == status.MOVES


@pytest.mark.parametrize("current,new,actor", ALLOWED)
def test_each_allowed_move_succeeds_for_its_actor(current, new, actor):
    changes = move(current, new, actor)
    assert changes["status"] == new
    assert changes["updatedAt"] is SERVER_TIMESTAMP


@pytest.mark.parametrize("current,new,actor", ALLOWED)
def test_each_allowed_move_is_refused_to_every_other_actor(current, new, actor):
    for other in ACTORS:
        if other == actor:
            continue
        with pytest.raises(HTTPException) as e:
            move(current, new, other)
        assert e.value.status_code == 403 and actor in e.value.detail


@pytest.mark.parametrize("current,new,actor", ALLOWED)
def test_each_move_saves_who_made_it_and_when(current, new, actor):
    changes = status.plan_move({"status": current}, new, actor, "uid-9", now=AT)
    assert isinstance(changes["statusHistory"], ArrayUnion)
    assert changes["statusHistory"].values == [{"from": current, "to": new, "actor": actor, "actorId": "uid-9", "at": AT}]


def test_extra_fields_ride_along_with_the_move():
    changes = move("Draft", "Applied", "borrower", extra={"submittedAt": SERVER_TIMESTAMP})
    assert changes["submittedAt"] is SERVER_TIMESTAMP


@pytest.mark.parametrize("current", status.STATUSES)
def test_every_status_has_at_least_one_move_refused_for_every_actor(current):
    refused = [new for new in status.STATUSES if (current, new) not in status.MOVES]
    assert refused, current
    for actor in ACTORS:
        with pytest.raises(HTTPException) as e:
            move(current, refused[0], actor)
        assert e.value.status_code == 409


@pytest.mark.parametrize("current", status.STATUSES)
def test_nothing_moves_to_itself(current):
    with pytest.raises(HTTPException) as e:
        move(current, current, "underwriter")
    assert e.value.status_code == 409


@pytest.mark.parametrize(
    "current,new",
    [
        ("Applied", "Draft"),  # no going back
        ("Draft", "AI Deliberated"),  # no skipping a step
        ("Applied", "Underwriter Approved"),
        ("AI Deliberated", "Funded"),
        ("Underwriter Approved", "Declined"),  # a decision isn't reversed
        ("Declined", "Funded"),
        ("Closed", "Applied"),  # Closed is the end
        ("Closed", "Closed"),
    ],
)
def test_skips_reversals_and_leaving_closed_are_409(current, new):
    with pytest.raises(HTTPException) as e:
        move(current, new, "underwriter")
    assert e.value.status_code == 409 and current in e.value.detail and new in e.value.detail


def test_an_unknown_status_is_409():
    with pytest.raises(HTTPException) as e:
        move("Applied", "Approved", "underwriter")
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e:
        status.plan_move({}, "Applied", "borrower", "u1")
    assert e.value.status_code == 409
