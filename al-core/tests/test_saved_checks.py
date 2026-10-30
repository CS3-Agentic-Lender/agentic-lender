"""POST /core/saved-checks and DELETE /core/saved-checks/{id} against an in-memory Firestore (AL-272)."""

import itertools
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import InvalidArgument
from google.cloud.firestore import SERVER_TIMESTAMP

from app import auth, saved_checks
from app.applications import PropertyIn
from app.main import app

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
NOW = datetime(2026, 10, 29, 9, 30, 0, 250000, tzinfo=timezone.utc)

CHECK = {
    "property": {
        "county": "Cork",
        "eircode": "T12 X8Y2",
        "property_type": "Semi-D",
        "bedrooms": 3,
        "floor_area_sqm": 110,
        "ber_rating": "B2",
        "asking_price_eur": 379000,
    },
    "estimated_value_eur": 371800,
    "asking_price_gap": 0.0194,
    "price_needs_review": False,
    "support_warnings": [],
    "model_version": "v2",
}


class FakeSnap:
    def __init__(self, doc_id, data):
        self.id, self._data, self.exists = doc_id, data, data is not None

    def to_dict(self):
        return dict(self._data) if self._data else None


class FakeDoc:
    def __init__(self, db, path):
        self.db, self.path, self.id = db, path, path.split("/")[-1]

    def set(self, data):
        self.db.store[self.path] = {k: (NOW if v is SERVER_TIMESTAMP else v) for k, v in data.items()}

    def get(self):
        # The real server refuses these ids on a read (checked against the emulator), with InvalidArgument.
        if self.id == ".." or (self.id.startswith("__") and self.id.endswith("__")):
            raise InvalidArgument(f'Resource id "{self.id}" is invalid')
        return FakeSnap(self.id, self.db.store.get(self.path))

    def delete(self):
        self.db.store.pop(self.path, None)

    def collection(self, name):
        return FakeCol(self.db, f"{self.path}/{name}")


class FakeCol:
    def __init__(self, db, path, limit=None):
        self.db, self.path, self._limit = db, path, limit

    def document(self, doc_id=None):
        return FakeDoc(self.db, f"{self.path}/{doc_id or next(self.db.ids)}")

    def limit(self, n):
        return FakeCol(self.db, self.path, n)

    def stream(self):
        """The documents directly under this collection, up to the limit."""
        found = [
            FakeSnap(path.split("/")[-1], doc)
            for path, doc in list(self.db.store.items())
            if path.startswith(f"{self.path}/") and "/" not in path[len(self.path) + 1:]
        ]
        return iter(found[: self._limit] if self._limit is not None else found)


class FakeDB:
    def __init__(self):
        self.store = {}
        self.ids = (f"check{n}" for n in itertools.count(1))

    def collection(self, name):
        return FakeCol(self, name)


@pytest.fixture
def fake(monkeypatch):
    """In-memory Firestore, signed in as the borrower with uid borrower1."""
    state = {"db": FakeDB(), "claims": {"uid": "borrower1", "role": "borrower"}}
    monkeypatch.setattr(saved_checks, "db", lambda: state["db"])
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: state["claims"])
    return state


def sign_in(fake, uid, role):
    fake["claims"] = {"uid": uid, "role": role}


def save(body=None):
    return client.post("/core/saved-checks", json=CHECK if body is None else body, headers=TOKEN)


def remove(check_id):
    return client.delete(f"/core/saved-checks/{check_id}", headers=TOKEN)


def check(**changes):
    """The valid check with some top-level fields changed."""
    return {**CHECK, **changes}


def property_of(**changes):
    """The valid check with some property fields changed (None removes one)."""
    prop = {**CHECK["property"], **changes}
    return check(property={k: v for k, v in prop.items() if v is not None})


def stored(fake, uid="borrower1"):
    prefix = f"users/{uid}/saved_checks/"
    return {path.removeprefix(prefix): doc for path, doc in fake["db"].store.items() if path.startswith(prefix)}


# AC2: POST saves one and returns 201 with its id and fields


def test_a_check_is_saved_and_comes_back_with_its_id_and_fields(fake):
    r = save()
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["id"] == "check1"
    assert body["property"] == CHECK["property"]
    assert (body["estimated_value_eur"], body["asking_price_gap"], body["price_needs_review"]) == (371800, 0.0194, False)
    assert body["support_warnings"] == [] and body["model_version"] == "v2"
    assert body["created_at"] == "2026-10-29T09:30:00.250Z"


def test_it_is_stored_under_the_borrower_in_camel_case(fake):
    save()
    assert stored(fake) == {
        "check1": {
            "property": {
                "county": "Cork", "eircode": "T12 X8Y2", "propertyType": "Semi-D", "bedrooms": 3,
                "floorAreaSqm": 110, "berRating": "B2", "askingPriceEur": 379000,
            },
            "estimatedValueEur": 371800,
            "askingPriceGap": 0.0194,
            "priceNeedsReview": False,
            "supportWarnings": [],
            "modelVersion": "v2",
            "createdAt": NOW,
        }
    }


def test_every_save_is_its_own_snapshot(fake):
    first, second = save().json()["id"], save().json()["id"]
    assert first != second and len(stored(fake)) == 2


def test_warnings_are_kept(fake):
    warnings = ["BER A0 is not a grade the model was trained on, so it is valued as an unknown rating."]
    assert save(check(support_warnings=warnings)).json()["support_warnings"] == warnings
    assert stored(fake)["check1"]["supportWarnings"] == warnings


def test_warnings_default_to_none(fake):
    body = {k: v for k, v in CHECK.items() if k != "support_warnings"}
    assert save(body).json()["support_warnings"] == []


def test_the_id_the_time_and_the_address_are_never_taken_from_the_body(fake):
    r = save(check(id="mine", created_at="2020-01-01T00:00:00Z", property={**CHECK["property"], "address_line_1": "12 Main Street", "address_line_2": "Ballincollig"}))
    assert r.status_code == 201
    assert r.json()["id"] == "check1" and r.json()["created_at"].startswith("2026-10-29")
    assert set(stored(fake)["check1"]["property"]) == {"county", "eircode", "propertyType", "bedrooms", "floorAreaSqm", "berRating", "askingPriceEur"}
    assert "address_line_1" not in r.json()["property"]


@pytest.mark.parametrize(
    "body,field",
    [
        (property_of(county=None), "property.county"),
        (property_of(county=""), "property.county"),
        (property_of(eircode=None), "property.eircode"),
        (property_of(property_type=None), "property.property_type"),
        (property_of(bedrooms=None), "property.bedrooms"),
        (property_of(bedrooms=21), "property.bedrooms"),
        (property_of(bedrooms=-1), "property.bedrooms"),
        (property_of(floor_area_sqm=None), "property.floor_area_sqm"),
        (property_of(floor_area_sqm=0), "property.floor_area_sqm"),
        (property_of(floor_area_sqm=10_001), "property.floor_area_sqm"),
        (property_of(ber_rating=None), "property.ber_rating"),
        (property_of(asking_price_eur=0), "property.asking_price_eur"),
        (property_of(asking_price_eur=100_000_001), "property.asking_price_eur"),
        (check(property=None), "property"),
        (check(estimated_value_eur=0), "estimated_value_eur"),
        (check(estimated_value_eur=None), "estimated_value_eur"),
        (check(estimated_value_eur=100_000_001), "estimated_value_eur"),
        (check(asking_price_gap=-1.5), "asking_price_gap"),
        (check(price_needs_review="maybe"), "price_needs_review"),
        (check(support_warnings=["x"] * 21), "support_warnings"),
        (check(support_warnings=["x" * 301]), "support_warnings.0"),
        (check(support_warnings=[""]), "support_warnings.0"),
        (check(model_version=""), "model_version"),
        (check(model_version=None), "model_version"),
    ],
)
def test_bad_input_is_422_naming_the_field_and_nothing_is_saved(fake, body, field):
    r = save(body)
    assert r.status_code == 422, r.json()
    err = r.json()["error"]
    assert err["code"] == "INVALID_FIELD" and err["field"] == field
    assert stored(fake) == {}


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_nan_and_infinity_are_rejected(fake, value):
    raw = '{"property": %s, "estimated_value_eur": %s, "model_version": "v2"}' % (
        '{"county":"Cork","eircode":"T12 X8Y2","property_type":"Semi-D","bedrooms":3,"floor_area_sqm":110,"ber_rating":"B2"}', value)
    r = client.post("/core/saved-checks", content=raw, headers={**TOKEN, "Content-Type": "application/json"})
    assert r.status_code == 422 and r.json()["error"]["field"] == "estimated_value_eur"


# AC3: the Eircode rule is the application's, and the gap and the flag need an asking price


@pytest.mark.parametrize("eircode", ["T12 X8Y2", "A65 F4E2", "D6W AB12", "D02 XY45"])
def test_a_valid_eircode_is_saved(fake, eircode):
    assert save(property_of(eircode=eircode)).status_code == 201


@pytest.mark.parametrize("eircode", ["t12 x8y2", "T12X8Y2", "T12  X8Y2", "T1 X8Y2", "nope", "T12 X8Y", ""])
def test_a_bad_eircode_is_422_and_the_application_would_refuse_it_too(fake, eircode):
    r = save(property_of(eircode=eircode))
    assert r.status_code == 422 and r.json()["error"]["field"] == "property.eircode"
    with pytest.raises(ValueError):  # the same rule, so a saved check can always fill an application
        PropertyIn(eircode=eircode)


def test_a_check_without_an_asking_price_has_no_gap_and_no_flag(fake):
    body = check(property=property_of(asking_price_eur=None)["property"], asking_price_gap=None, price_needs_review=None)
    r = save(body)
    assert r.status_code == 201
    assert r.json()["property"]["asking_price_eur"] is None
    assert r.json()["asking_price_gap"] is None and r.json()["price_needs_review"] is None
    doc = stored(fake)["check1"]
    assert "askingPriceEur" not in doc["property"] and doc["askingPriceGap"] is None and doc["priceNeedsReview"] is None


def test_the_gap_and_the_flag_may_be_left_out_entirely(fake):
    body = {k: v for k, v in property_of(asking_price_eur=None).items() if k not in ("asking_price_gap", "price_needs_review")}
    r = save(body)
    assert r.status_code == 201 and r.json()["asking_price_gap"] is None and r.json()["price_needs_review"] is None


@pytest.mark.parametrize("field,value", [("asking_price_gap", 0.1), ("price_needs_review", True), ("price_needs_review", False)])
def test_a_gap_or_a_flag_without_an_asking_price_is_422_naming_it(fake, field, value):
    body = {**property_of(asking_price_eur=None), "asking_price_gap": None, "price_needs_review": None, field: value}
    r = save(body)
    assert r.status_code == 422 and r.json()["error"]["field"] == field
    assert stored(fake) == {}


def test_an_over_priced_check_keeps_its_flag_and_gap(fake):
    r = save(check(asking_price_gap=0.41, price_needs_review=True))
    assert r.status_code == 201 and r.json()["price_needs_review"] is True and r.json()["asking_price_gap"] == 0.41


def test_the_saved_property_follows_the_applications_names_and_limits():
    """Same fields, same limits as the application's property, so a check can always fill an application."""
    for name, field in saved_checks.SavedCheckProperty.model_fields.items():
        assert name in PropertyIn.model_fields, name
        # The application's fields are optional on a Draft, so only the limits are compared.
        assert field.metadata == PropertyIn.model_fields[name].metadata, name


# AC4: DELETE removes the caller's own check


def test_a_check_is_removed(fake):
    check_id = save().json()["id"]
    r = remove(check_id)
    assert r.status_code == 204 and r.content == b""
    assert stored(fake) == {}


def test_only_that_check_is_removed(fake):
    first, second = save().json()["id"], save().json()["id"]
    remove(first)
    assert set(stored(fake)) == {second}


def test_removing_it_twice_is_404(fake):
    check_id = save().json()["id"]
    remove(check_id)
    r = remove(check_id)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_an_unknown_id_is_404(fake):
    assert remove("nope").status_code == 404


def test_someone_elses_check_is_404_and_stays(fake):
    check_id = save().json()["id"]
    sign_in(fake, "borrower2", "borrower")
    r = remove(check_id)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert set(stored(fake, "borrower1")) == {check_id}


def test_the_same_id_for_another_borrower_is_their_own_check(fake):
    first = save().json()["id"]
    sign_in(fake, "borrower2", "borrower")
    second = save().json()["id"]
    assert first != second  # one generator, so the ids differ; the paths are what keep them apart
    assert remove(first).status_code == 404
    assert remove(second).status_code == 204 and set(stored(fake, "borrower1")) == {first}


@pytest.mark.parametrize("check_id", ["..", "__name__", "a" * 2000])
def test_an_id_that_is_not_a_usable_document_id_is_404_not_500(fake, check_id):
    # ".." and "__name__" make Firestore raise InvalidArgument, which must not become a 500.
    r = remove(check_id)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


# AC5: only a borrower can call them


@pytest.mark.parametrize("role", ["broker", "underwriter"])
def test_staff_get_403_and_nothing_changes(fake, role):
    check_id = save().json()["id"]
    sign_in(fake, "staff1", role)
    r = save()
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    r = remove(check_id)
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert set(stored(fake, "borrower1")) == {check_id} and stored(fake, "staff1") == {}


def test_a_token_without_a_role_is_403(fake):
    fake["claims"] = {"uid": "newcomer"}
    assert save().status_code == 403 and remove("check1").status_code == 403


def test_both_endpoints_need_a_token():
    r = client.post("/core/saved-checks", json=CHECK)
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert client.delete("/core/saved-checks/check1").status_code == 401


# AC6: at most 20 saved checks


def test_twenty_checks_can_be_saved(fake):
    assert all(save().status_code == 201 for _ in range(saved_checks.MAX_SAVED_CHECKS))
    assert len(stored(fake)) == 20


def test_the_21st_is_409_saying_why_and_nothing_is_written(fake):
    for _ in range(saved_checks.MAX_SAVED_CHECKS):
        save()
    r = save()
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    assert "at most 20" in r.json()["error"]["message"] and "Delete one" in r.json()["error"]["message"]
    assert len(stored(fake)) == 20


def test_deleting_one_allows_another(fake):
    ids = [save().json()["id"] for _ in range(saved_checks.MAX_SAVED_CHECKS)]
    assert save().status_code == 409
    assert remove(ids[0]).status_code == 204
    assert save().status_code == 201 and len(stored(fake)) == 20


def test_another_borrowers_checks_do_not_count(fake):
    for _ in range(saved_checks.MAX_SAVED_CHECKS):
        save()
    sign_in(fake, "borrower2", "borrower")
    assert save().status_code == 201 and len(stored(fake, "borrower2")) == 1


# AC8: the endpoints are in the API docs


def test_openapi_lists_both_endpoints_with_models():
    spec = client.get("/core/openapi.json").json()
    post = spec["paths"]["/core/saved-checks"]["post"]
    assert "SavedCheckIn" in str(post["requestBody"]) and "SavedCheckOut" in str(post["responses"]["201"])
    assert "204" in spec["paths"]["/core/saved-checks/{check_id}"]["delete"]["responses"]
