"""POST /core/applications and GET /core/applications/{id} against an in-memory Firestore."""

from datetime import datetime, timezone
import itertools

import pytest
from fastapi.testclient import TestClient
from google.cloud.firestore import SERVER_TIMESTAMP

from app import applications, auth
from app.main import app

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
NOW = datetime(2026, 10, 13, 10, 30, 0, 250000, tzinfo=timezone.utc)

ALICE = {"uid": "borrower1", "role": "borrower", "fullName": "Alice Byrne", "brokerId": "broker1"}
BEN = {"uid": "borrower2", "role": "borrower", "fullName": "Ben Walsh", "brokerId": "broker2"}
NO_BROKER = {"uid": "borrower3", "role": "borrower", "fullName": "Cara Doyle"}

FULL_MORTGAGE = {
    "loan_type": "mortgage",
    "gross_income_eur": 75000,
    "monthly_debts_eur": 300,
    "monthly_take_home_eur": 4200,
    "monthly_living_costs_eur": 1800,
    "employment_type": "employed",
    "years_in_current_job": 4,
    "applicants": "single",
    "deposit_eur": 35000,
    "first_time_buyer": True,
    "loan_amount_eur": 270000,
    "term_years": 30,
    "property": {
        "county": "Cork",
        "property_type": "Semi-detached house",
        "bedrooms": 3,
        "floor_area_sqm": 110,
        "ber_rating": "B2",
        "asking_price_eur": 315000,
    },
}


class FakeSnap:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data else None


class FakeDoc:
    def __init__(self, store, path):
        self.store, self.path = store, path
        self.id = path.split("/")[-1]

    def set(self, data):
        self.store[self.path] = {k: (NOW if v is SERVER_TIMESTAMP else v) for k, v in data.items()}

    def get(self):
        return FakeSnap(self.id, self.store.get(self.path))


class FakeDB:
    def __init__(self):
        self.store = {}
        self.ids = (f"app{n}" for n in itertools.count(1))

    def collection(self, name):
        db = self

        class Col:
            def document(self, doc_id=None):
                return FakeDoc(db.store, f"{name}/{doc_id or next(db.ids)}")

            def where(self, filter):
                field, value = filter.field_path, filter.value

                class Query:
                    def stream(self):
                        for path, doc in list(db.store.items()):
                            if path.startswith(f"{name}/") and doc.get(field) == value:
                                yield FakeSnap(path.split("/")[-1], doc)

                return Query()

        return Col()


@pytest.fixture
def fake(monkeypatch):
    """In-memory Firestore with three borrower profiles, signed in as Alice by default."""
    state = {"db": FakeDB(), "claims": {"uid": "borrower1", "role": "borrower"}}
    for profile in (ALICE, BEN, NO_BROKER):
        state["db"].store[f"users/{profile['uid']}"] = dict(profile)
    monkeypatch.setattr(applications, "db", lambda: state["db"])
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda token, check_revoked: state["claims"])
    return state


def sign_in(fake, uid, role):
    fake["claims"] = {"uid": uid, "role": role}


def create(body):
    return client.post("/core/applications", json=body, headers=TOKEN)


def read(app_id):
    return client.get(f"/core/applications/{app_id}", headers=TOKEN)


# AC1: a borrower creates a Draft and reads it back


def test_a_draft_needs_only_the_loan_type(fake):
    r = create({"loan_type": "mortgage"})
    assert r.status_code == 201
    body = r.json()
    assert body["id"] == "app1" and body["status"] == "Draft" and body["loan_type"] == "mortgage"
    assert body["borrower_id"] == "borrower1" and body["broker_id"] == "broker1"
    assert body["borrower_name"] == "Alice Byrne"
    assert body["property"] is None and body["loan_amount_eur"] is None
    assert body["created_at"] == body["updated_at"] == "2026-10-13T10:30:00.250Z"
    assert body["submitted_at"] is None


def test_draft_is_stored_in_camel_case_with_the_broker_and_name_copied(fake):
    create(FULL_MORTGAGE)
    doc = fake["db"].store["applications/app1"]
    assert doc == {
        "borrowerId": "borrower1",
        "brokerId": "broker1",
        "borrowerName": "Alice Byrne",
        "status": "Draft",
        "loanType": "mortgage",
        "grossIncomeEur": 75000,
        "monthlyDebtsEur": 300,
        "monthlyTakeHomeEur": 4200,
        "monthlyLivingCostsEur": 1800,
        "employmentType": "employed",
        "yearsInCurrentJob": 4,
        "applicants": "single",
        "depositEur": 35000,
        "firstTimeBuyer": True,
        "loanAmountEur": 270000,
        "termYears": 30,
        "property": {
            "county": "Cork",
            "propertyType": "Semi-detached house",
            "bedrooms": 3,
            "floorAreaSqm": 110,
            "berRating": "B2",
            "askingPriceEur": 315000,
        },
        "createdAt": NOW,
        "updatedAt": NOW,
    }


def test_full_draft_reads_back_the_same_in_snake_case(fake):
    created = create(FULL_MORTGAGE).json()
    r = read(created["id"])
    assert r.status_code == 200 and r.json() == created
    for key, value in FULL_MORTGAGE.items():
        assert created[key] == value, key


def test_a_partial_property_is_kept_as_given(fake):
    r = create({"loan_type": "mortgage", "property": {"county": "Cork"}})
    assert r.json()["property"]["county"] == "Cork" and r.json()["property"]["bedrooms"] is None
    assert fake["db"].store["applications/app1"]["property"] == {"county": "Cork"}


def test_heloc_draft_keeps_the_existing_balance(fake):
    r = create({"loan_type": "heloc", "existing_mortgage_balance_eur": 120000, "loan_amount_eur": 60000})
    assert r.status_code == 201 and r.json()["existing_mortgage_balance_eur"] == 120000


def test_status_borrower_and_broker_are_never_taken_from_the_body(fake):
    r = create({"loan_type": "mortgage", "status": "Underwriter Approved", "broker_id": "broker2",
                "borrower_id": "borrower2", "ltv_pct": 10})
    body = r.json()
    assert body["status"] == "Draft" and body["broker_id"] == "broker1" and body["borrower_id"] == "borrower1"
    assert body["ltv_pct"] is None


# AL-20: one active application per borrower


def test_a_second_call_returns_the_existing_draft_unchanged(fake):
    first = create({"loan_type": "mortgage", "term_years": 30})
    again = create({"loan_type": "heloc", "term_years": 10})
    assert first.status_code == 201 and again.status_code == 200
    assert again.json() == first.json()
    assert len([k for k in fake["db"].store if k.startswith("applications/")]) == 1


@pytest.mark.parametrize("status", ["Applied", "AI Deliberated", "Underwriter Approved", "Funded"])
def test_an_application_in_progress_blocks_a_new_one(fake, status):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    fake["db"].store[f"applications/{app_id}"]["status"] = status
    r = create({"loan_type": "mortgage"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    assert app_id in r.json()["error"]["message"]


@pytest.mark.parametrize("status", ["Declined", "Closed"])
def test_a_finished_application_allows_a_new_draft(fake, status):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    fake["db"].store[f"applications/{app_id}"]["status"] = status
    r = create({"loan_type": "mortgage"})
    assert r.status_code == 201 and r.json()["id"] != app_id


def test_another_borrowers_draft_does_not_count(fake):
    create({"loan_type": "mortgage"})
    sign_in(fake, "borrower2", "borrower")
    r = create({"loan_type": "mortgage"})
    assert r.status_code == 201 and r.json()["borrower_id"] == "borrower2"


def test_another_borrower_gets_404_for_someone_elses_application(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    sign_in(fake, "borrower2", "borrower")
    r = read(app_id)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_unknown_id_is_404(fake):
    assert read("nope").status_code == 404


# AC2: brokers read only their assigned applications, underwriters read all


def test_the_assigned_broker_can_read_it(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    sign_in(fake, "broker1", "broker")
    assert read(app_id).status_code == 200


def test_another_broker_gets_404(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    sign_in(fake, "broker2", "broker")
    assert read(app_id).status_code == 404


def test_an_underwriter_can_read_any_application(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    sign_in(fake, "underwriter1", "underwriter")
    assert read(app_id).status_code == 200


def test_the_old_broker_keeps_the_application_after_a_broker_change(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    fake["db"].store["users/borrower1"]["brokerId"] = "broker2"  # borrower changes broker
    sign_in(fake, "broker1", "broker")
    r = read(app_id)
    assert r.status_code == 200 and r.json()["borrower_name"] == "Alice Byrne"
    fake["db"].store[f"applications/{app_id}"]["status"] = "Closed"
    sign_in(fake, "borrower1", "borrower")
    assert create({"loan_type": "mortgage"}).json()["broker_id"] == "broker2"  # new ones go to the new broker


def test_a_token_without_a_role_cannot_read(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    fake["claims"] = {"uid": "borrower1"}
    assert read(app_id).status_code == 404


@pytest.mark.parametrize("role", ["broker", "underwriter"])
def test_only_borrowers_can_create(fake, role):
    sign_in(fake, "staff1", role)
    r = create({"loan_type": "mortgage"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert not any(k.startswith("applications/") for k in fake["db"].store)


def test_no_profile_yet_is_409(fake):
    sign_in(fake, "newbie", "borrower")
    r = create({"loan_type": "mortgage"})
    assert r.status_code == 409 and "POST /core/me" in r.json()["error"]["message"]


def test_no_broker_chosen_is_409(fake):
    sign_in(fake, "borrower3", "borrower")
    r = create({"loan_type": "mortgage"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    assert "broker" in r.json()["error"]["message"]


def test_both_endpoints_need_a_token():
    assert client.post("/core/applications", json={"loan_type": "mortgage"}).status_code == 401
    assert client.get("/core/applications/app1").status_code == 401


# AC3: 422 names the field


@pytest.mark.parametrize(
    "body, field",
    [
        ({}, "loan_type"),
        ({"loan_type": "car"}, "loan_type"),
        ({"loan_type": "mortgage", "gross_income_eur": -1}, "gross_income_eur"),
        ({"loan_type": "mortgage", "loan_amount_eur": 0}, "loan_amount_eur"),
        ({"loan_type": "mortgage", "term_years": 41}, "term_years"),
        ({"loan_type": "mortgage", "term_years": 0}, "term_years"),
        ({"loan_type": "mortgage", "employment_type": "retired"}, "employment_type"),
        ({"loan_type": "mortgage", "applicants": "three"}, "applicants"),
        ({"loan_type": "mortgage", "years_in_current_job": -2}, "years_in_current_job"),
        ({"loan_type": "mortgage", "property": {"bedrooms": 21}}, "property.bedrooms"),
        ({"loan_type": "mortgage", "property": {"floor_area_sqm": 0}}, "property.floor_area_sqm"),
        ({"loan_type": "mortgage", "property": {"county": ""}}, "property.county"),
        ({"loan_type": "mortgage", "existing_mortgage_balance_eur": 100000}, "existing_mortgage_balance_eur"),
        ({"loan_type": "heloc", "deposit_eur": 20000}, "deposit_eur"),
        ({"loan_type": "heloc", "first_time_buyer": True}, "first_time_buyer"),
    ],
)
def test_invalid_input_is_422_naming_the_field(fake, body, field):
    r = create(body)
    assert r.status_code == 422, r.json()
    err = r.json()["error"]
    assert err["code"] == "INVALID_FIELD" and err["field"] == field
    assert not any(k.startswith("applications/") for k in fake["db"].store)


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_nan_and_infinity_are_rejected(fake, value):
    raw = '{"loan_type": "mortgage", "loan_amount_eur": %s}' % value
    r = client.post("/core/applications", content=raw, headers={**TOKEN, "Content-Type": "application/json"})
    assert r.status_code == 422 and r.json()["error"]["field"] == "loan_amount_eur"


def test_mortgage_only_message_says_which_loan_type(fake):
    r = create({"loan_type": "heloc", "deposit_eur": 20000})
    assert "only applies to a mortgage" in r.json()["error"]["message"]


def test_seeded_application_with_string_timestamps_reads_back(fake):
    fake["db"].store["applications/app-applied"] = {
        "borrowerId": "borrower1", "brokerId": "broker1", "status": "Applied", "loanType": "mortgage",
        "createdAt": "2026-10-02T10:00:00Z", "updatedAt": "2026-10-03T09:00:00Z",
    }
    r = read("app-applied")
    assert r.status_code == 200 and r.json()["created_at"] == "2026-10-02T10:00:00Z"


# AC4: /core/docs lists both endpoints with their models


def test_openapi_lists_both_endpoints_with_models():
    spec = client.get("/core/openapi.json").json()
    post = spec["paths"]["/core/applications"]["post"]
    get = spec["paths"]["/core/applications/{application_id}"]["get"]
    assert "DraftIn" in str(post["requestBody"]) and "ApplicationOut" in str(post["responses"]["201"])
    assert "ApplicationOut" in str(get["responses"]["200"])
    assert client.get("/core/docs").status_code == 200
