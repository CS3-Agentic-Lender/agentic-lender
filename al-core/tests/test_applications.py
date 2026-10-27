"""POST, PATCH and GET on /core/applications against an in-memory Firestore."""

from datetime import datetime, timezone
import itertools

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import FailedPrecondition
from google.cloud.firestore import DELETE_FIELD, SERVER_TIMESTAMP

from app import applications, auth
from app.main import app

client = TestClient(app)
TOKEN = {"Authorization": "Bearer ok"}
NOW = datetime(2026, 10, 13, 10, 30, 0, 250000, tzinfo=timezone.utc)
LATER = datetime(2026, 10, 14, 9, 0, 0, tzinfo=timezone.utc)

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
        "address_line_1": "12 Main Street",
        "address_line_2": "Ballincollig",
        "eircode": "P31 X2Y3",
        "county": "Cork",
        "property_type": "Semi-detached house",
        "bedrooms": 3,
        "floor_area_sqm": 110,
        "ber_rating": "B2",
        "asking_price_eur": 315000,
    },
}


class FakeSnap:
    def __init__(self, doc_id, data, update_time=None):
        self.id = doc_id
        self._data = data
        self.exists = data is not None
        self.update_time = update_time

    def to_dict(self):
        return dict(self._data) if self._data else None


class FakeDoc:
    def __init__(self, db, path):
        self.db, self.store, self.path = db, db.store, path
        self.id = path.split("/")[-1]

    def set(self, data):
        self.store[self.path] = {k: (NOW if v is SERVER_TIMESTAMP else v) for k, v in data.items()}
        self.db.versions[self.path] = self.db.versions.get(self.path, 0) + 1

    def update(self, changes, option=None):
        """Like Firestore: dotted keys reach into maps, DELETE_FIELD removes, SERVER_TIMESTAMP is LATER,
        and a last_update_time option refuses the write if the document changed since that read."""
        if option is not None and option != self.db.versions.get(self.path):
            raise FailedPrecondition("document changed since it was read")
        self.db.versions[self.path] = self.db.versions.get(self.path, 0) + 1
        doc = self.store[self.path]
        for key, value in changes.items():
            *parents, last = key.split(".")
            target = doc
            for part in parents:
                target = target.setdefault(part, {})
            if value is DELETE_FIELD:
                target.pop(last, None)
            else:
                target[last] = LATER if value is SERVER_TIMESTAMP else value

    def get(self):
        return FakeSnap(self.id, self.store.get(self.path), self.db.versions.get(self.path))


class FakeDB:
    def __init__(self):
        self.store = {}
        self.versions = {}  # path -> write count, standing in for Firestore's update_time
        self.ids = (f"app{n}" for n in itertools.count(1))

    def write_option(self, last_update_time):
        return last_update_time

    def collection(self, name):
        db = self

        class Col:
            def document(self, doc_id=None):
                return FakeDoc(db, f"{name}/{doc_id or next(db.ids)}")

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
            "addressLine1": "12 Main Street",
            "addressLine2": "Ballincollig",
            "eircode": "P31 X2Y3",
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


# AL-252: ltv_band and risk_tier are returned, set only by al-ai


def test_ltv_band_and_risk_tier_are_null_until_al_ai_sets_them(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    body = read(app_id).json()
    assert body["ltv_band"] is None and body["risk_tier"] is None


@pytest.mark.parametrize("uid,role", [("borrower1", "borrower"), ("broker1", "broker"), ("underwriter1", "underwriter")])
def test_the_borrower_the_assigned_broker_and_an_underwriter_get_the_band_and_tier(fake, uid, role):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    fake["db"].store[f"applications/{app_id}"].update({"ltvBand": "80_to_90", "riskTier": "C"})
    sign_in(fake, uid, role)
    body = read(app_id).json()
    assert body["ltv_band"] == "80_to_90" and body["risk_tier"] == "C"


def test_the_band_and_tier_are_never_taken_from_a_new_draft(fake):
    r = create({"loan_type": "mortgage", "ltv_band": "over_90", "risk_tier": "D"})
    body = r.json()
    assert body["ltv_band"] is None and body["risk_tier"] is None
    stored = fake["db"].store[f"applications/{body['id']}"]
    assert "ltvBand" not in stored and "riskTier" not in stored


def test_an_edit_never_changes_or_clears_the_band_and_tier(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    fake["db"].store[f"applications/{app_id}"].update({"ltvBand": "80_or_less", "riskTier": "A"})
    body = edit(app_id, {"ltv_band": "over_90", "risk_tier": "D", "loan_amount_eur": 200000}).json()
    assert body["ltv_band"] == "80_or_less" and body["risk_tier"] == "A" and body["loan_amount_eur"] == 200000
    body = edit(app_id, {"ltv_band": None, "risk_tier": None}).json()
    assert body["ltv_band"] == "80_or_less" and body["risk_tier"] == "A"
    stored = fake["db"].store[f"applications/{app_id}"]
    assert stored["ltvBand"] == "80_or_less" and stored["riskTier"] == "A"


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


# PATCH /core/applications/{id}: edit a Draft (AL-244)


def edit(app_id, body):
    return client.patch(f"/core/applications/{app_id}", json=body, headers=TOKEN)


def stored(fake, app_id="app1"):
    return fake["db"].store[f"applications/{app_id}"]


# AC1: change any Draft field; fields not sent stay as they were


def test_edit_changes_only_the_fields_sent(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    r = edit(app_id, {"gross_income_eur": 80000, "term_years": 25})
    assert r.status_code == 200
    body = r.json()
    assert body["gross_income_eur"] == 80000 and body["term_years"] == 25
    assert body["loan_amount_eur"] == 270000 and body["property"]["county"] == "Cork"
    assert body["updated_at"] == "2026-10-14T09:00:00.000Z" and body["created_at"].startswith("2026-10-13")
    assert read(app_id).json() == body


def test_every_draft_field_can_be_set_by_edit(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    body = {k: v for k, v in FULL_MORTGAGE.items() if k != "loan_type"}
    r = edit(app_id, body)
    assert r.status_code == 200
    for key, value in body.items():
        assert r.json()[key] == value, key


def test_property_is_merged_field_by_field(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    r = edit(app_id, {"property": {"bedrooms": 4, "eircode": "T12 X5Y6"}})
    prop = r.json()["property"]
    assert prop["bedrooms"] == 4 and prop["eircode"] == "T12 X5Y6"
    assert prop["county"] == "Cork" and prop["asking_price_eur"] == 315000
    assert stored(fake)["property"]["eircode"] == "T12 X5Y6"


def test_the_new_address_fields_are_stored_in_camel_case(fake):
    app_id = create({"loan_type": "mortgage"}).json()["id"]
    edit(app_id, {"property": {"address_line_1": "12 Main Street", "address_line_2": "Ballincollig",
                               "eircode": "P31 X2Y3", "county": "Cork", "asking_price_eur": 315000}})
    assert stored(fake)["property"] == {"addressLine1": "12 Main Street", "addressLine2": "Ballincollig",
                                        "eircode": "P31 X2Y3", "county": "Cork", "askingPriceEur": 315000}


def test_the_address_can_be_given_when_the_draft_is_created(fake):
    r = create({"loan_type": "mortgage", "property": {"address_line_1": "12 Main Street", "eircode": "P31 X2Y3"}})
    assert r.status_code == 201 and r.json()["property"]["address_line_1"] == "12 Main Street"


def test_null_clears_a_field_and_an_empty_line_2_is_absent(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    edit(app_id, {"property": {"address_line_2": "Flat 2"}})
    r = edit(app_id, {"deposit_eur": None, "property": {"bedrooms": None, "address_line_2": ""}})
    assert r.json()["deposit_eur"] is None and r.json()["property"]["bedrooms"] is None
    assert "depositEur" not in stored(fake)
    assert "bedrooms" not in stored(fake)["property"] and "addressLine2" not in stored(fake)["property"]


def test_null_property_clears_the_whole_property(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    r = edit(app_id, {"property": None})
    assert r.json()["property"] is None and "property" not in stored(fake)


def test_an_empty_body_only_touches_updated_at(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    before = dict(stored(fake))
    r = edit(app_id, {})
    assert r.status_code == 200
    after = dict(stored(fake))
    assert after.pop("updatedAt") == LATER
    before.pop("updatedAt")
    assert after == before


def test_status_borrower_broker_name_and_timestamps_are_ignored(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    r = edit(app_id, {"status": "Funded", "borrower_id": "borrower2", "broker_id": "broker2",
                      "borrower_name": "Someone Else", "created_at": "2020-01-01T00:00:00Z",
                      "submitted_at": "2020-01-01T00:00:00Z", "ltv_pct": 5})
    body = r.json()
    assert r.status_code == 200 and body["status"] == "Draft"
    assert body["borrower_id"] == "borrower1" and body["broker_id"] == "broker1"
    assert body["borrower_name"] == "Alice Byrne" and body["submitted_at"] is None and body["ltv_pct"] is None
    assert body["created_at"].startswith("2026-10-13")


def test_changing_to_a_heloc_drops_the_mortgage_only_fields(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    r = edit(app_id, {"loan_type": "heloc", "existing_mortgage_balance_eur": 120000})
    body = r.json()
    assert r.status_code == 200 and body["loan_type"] == "heloc"
    assert body["deposit_eur"] is None and body["first_time_buyer"] is None
    assert body["existing_mortgage_balance_eur"] == 120000
    assert "depositEur" not in stored(fake) and "firstTimeBuyer" not in stored(fake)


def test_changing_to_a_mortgage_drops_the_existing_balance(fake):
    app_id = create({"loan_type": "heloc", "existing_mortgage_balance_eur": 120000}).json()["id"]
    r = edit(app_id, {"loan_type": "mortgage"})
    assert r.json()["loan_type"] == "mortgage" and r.json()["existing_mortgage_balance_eur"] is None


# AC2: only a Draft can be edited


@pytest.mark.parametrize("status", ["Applied", "AI Deliberated", "Underwriter Approved", "Declined", "Funded", "Closed"])
def test_editing_a_submitted_application_is_409(fake, status):
    app_id = create(FULL_MORTGAGE).json()["id"]
    stored(fake)["status"] = status
    before = dict(stored(fake))
    r = edit(app_id, {"term_years": 20})
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    assert status in r.json()["error"]["message"]
    assert stored(fake) == before


# AC3: nobody else can edit it


def test_another_borrower_gets_404_and_nothing_changes(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    before = dict(stored(fake))
    sign_in(fake, "borrower2", "borrower")
    r = edit(app_id, {"term_years": 20})
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert stored(fake) == before


@pytest.mark.parametrize("uid, role", [("broker1", "broker"), ("underwriter1", "underwriter")])
def test_staff_get_403_and_nothing_changes(fake, uid, role):
    app_id = create(FULL_MORTGAGE).json()["id"]
    before = dict(stored(fake))
    sign_in(fake, uid, role)
    r = edit(app_id, {"term_years": 20})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert stored(fake) == before


def test_editing_an_unknown_id_is_404(fake):
    assert edit("nope", {"term_years": 20}).status_code == 404


def test_edit_needs_a_token():
    assert client.patch("/core/applications/app1", json={}).status_code == 401


# AC4: invalid values are 422 naming the field, with the same rules as creating


@pytest.mark.parametrize(
    "body, field",
    [
        ({"loan_type": None}, "loan_type"),
        ({"loan_type": "car"}, "loan_type"),
        ({"gross_income_eur": -1}, "gross_income_eur"),
        ({"loan_amount_eur": 0}, "loan_amount_eur"),
        ({"term_years": 41}, "term_years"),
        ({"employment_type": "retired"}, "employment_type"),
        ({"property": {"bedrooms": 21}}, "property.bedrooms"),
        ({"property": {"eircode": "t12x5y6"}}, "property.eircode"),
        ({"property": {"eircode": "T12X5Y6"}}, "property.eircode"),
        ({"property": {"address_line_1": ""}}, "property.address_line_1"),
        ({"property": {"address_line_1": "x" * 201}}, "property.address_line_1"),
        ({"existing_mortgage_balance_eur": 100000}, "existing_mortgage_balance_eur"),
        ({"loan_type": "heloc", "deposit_eur": 20000}, "deposit_eur"),
    ],
)
def test_invalid_edit_is_422_naming_the_field_and_nothing_changes(fake, body, field):
    app_id = create(FULL_MORTGAGE).json()["id"]
    before = dict(stored(fake))
    r = edit(app_id, body)
    assert r.status_code == 422, r.json()
    assert r.json()["error"]["code"] == "INVALID_FIELD" and r.json()["error"]["field"] == field
    assert stored(fake) == before


def test_a_bad_eircode_is_also_422_when_creating(fake):
    r = create({"loan_type": "mortgage", "property": {"eircode": "nope"}})
    assert r.status_code == 422 and r.json()["error"]["field"] == "property.eircode"


def test_openapi_lists_the_patch_with_its_model():
    spec = client.get("/core/openapi.json").json()
    patch = spec["paths"]["/core/applications/{application_id}"]["patch"]
    assert "DraftPatch" in str(patch["requestBody"]) and "ApplicationOut" in str(patch["responses"]["200"])


# POST /core/applications/{id}/submit (AL-245)

FULL_HELOC = {
    **{k: v for k, v in FULL_MORTGAGE.items() if k not in ("deposit_eur", "first_time_buyer")},
    "loan_type": "heloc",
    "existing_mortgage_balance_eur": 120000,
    "loan_amount_eur": 60000,
}


def submit(app_id):
    return client.post(f"/core/applications/{app_id}/submit", headers=TOKEN)


# AC1: a complete Draft moves to Applied


def test_a_complete_mortgage_draft_moves_to_applied(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    r = submit(app_id)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "Applied"
    assert body["submitted_at"] == body["updated_at"] == "2026-10-14T09:00:00.000Z"
    assert body["created_at"].startswith("2026-10-13")
    assert stored(fake)["status"] == "Applied" and stored(fake)["submittedAt"] == LATER
    assert read(app_id).json() == body


def test_a_complete_heloc_draft_moves_to_applied(fake):
    app_id = create(FULL_HELOC).json()["id"]
    r = submit(app_id)
    assert r.status_code == 200 and r.json()["status"] == "Applied"


def test_zero_and_false_count_as_answers(fake):
    app_id = create({**FULL_MORTGAGE, "monthly_debts_eur": 0, "years_in_current_job": 0,
                     "deposit_eur": 0, "first_time_buyer": False}).json()["id"]
    assert submit(app_id).json()["status"] == "Applied"


def test_zero_bedrooms_counts_as_an_answer(fake):
    body = {**FULL_MORTGAGE, "property": {**FULL_MORTGAGE["property"], "bedrooms": 0}}
    app_id = create(body).json()["id"]
    r = submit(app_id)
    assert r.status_code == 200 and r.json()["status"] == "Applied"


def test_the_valuation_fields_come_after_the_address_and_before_the_price(fake):
    body = {**FULL_MORTGAGE, "property": {"address_line_1": "12 Main Street", "county": "Cork", "eircode": "P31 X2Y3"}}
    app_id = create(body).json()["id"]
    assert submit(app_id).json()["error"]["field"] == "property.property_type"
    edit(app_id, {"property": {"property_type": "Semi-detached house", "bedrooms": 3, "floor_area_sqm": 110, "ber_rating": "B2"}})
    assert submit(app_id).json()["error"]["field"] == "property.asking_price_eur"


def test_address_line_2_is_not_needed(fake):
    body = {**FULL_MORTGAGE, "property": {k: v for k, v in FULL_MORTGAGE["property"].items() if k != "address_line_2"}}
    app_id = create(body).json()["id"]
    assert submit(app_id).status_code == 200


# AC2: a missing field is 422 naming the first one, and it stays a Draft

MORTGAGE_NEEDS = [
    "applicants", "gross_income_eur", "monthly_debts_eur", "monthly_take_home_eur",
    "monthly_living_costs_eur", "employment_type", "years_in_current_job", "loan_amount_eur",
    "term_years", "deposit_eur", "first_time_buyer",
]
PROPERTY_NEEDS = [
    "address_line_1", "county", "eircode",
    "property_type", "bedrooms", "floor_area_sqm", "ber_rating",  # what the valuation needs (AL-251)
    "asking_price_eur",
]


@pytest.mark.parametrize("field", MORTGAGE_NEEDS + [f"property.{f}" for f in PROPERTY_NEEDS])
def test_a_mortgage_missing_a_field_is_422_naming_it(fake, field):
    app_id = create(FULL_MORTGAGE).json()["id"]
    edit(app_id, {"property": {field.split(".")[1]: None}} if "." in field else {field: None})
    before = dict(stored(fake))
    r = submit(app_id)
    assert r.status_code == 422, r.json()
    err = r.json()["error"]
    assert err["code"] == "INVALID_FIELD" and err["field"] == field
    assert err["message"] == f"{field}: is required to submit"
    assert stored(fake) == before and stored(fake)["status"] == "Draft"


@pytest.mark.parametrize("field", ["existing_mortgage_balance_eur", "loan_amount_eur"])
def test_a_heloc_missing_a_field_is_422_naming_it(fake, field):
    app_id = create(FULL_HELOC).json()["id"]
    edit(app_id, {field: None})
    r = submit(app_id)
    assert r.status_code == 422 and r.json()["error"]["field"] == field


def test_a_heloc_does_not_need_the_deposit_fields(fake):
    app_id = create(FULL_HELOC).json()["id"]
    assert stored(fake).get("depositEur") is None
    assert submit(app_id).status_code == 200


def test_the_first_missing_field_is_named(fake):
    app_id = create({"loan_type": "mortgage", "applicants": "single"}).json()["id"]
    r = submit(app_id)
    assert r.json()["error"]["field"] == "gross_income_eur"


def test_an_empty_property_names_the_first_property_field(fake):
    body = {k: v for k, v in FULL_MORTGAGE.items() if k != "property"}
    app_id = create(body).json()["id"]
    assert submit(app_id).json()["error"]["field"] == "property.address_line_1"


def test_after_filling_in_the_missing_field_it_submits(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    edit(app_id, {"property": {"eircode": None}})
    assert submit(app_id).status_code == 422
    edit(app_id, {"property": {"eircode": "P31 X2Y3"}})
    assert submit(app_id).json()["status"] == "Applied"


# AC3: submitting again is safe; any later status is 409


def test_submitting_again_returns_it_unchanged(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    first = submit(app_id).json()
    before = dict(stored(fake))
    again = submit(app_id)
    assert again.status_code == 200 and again.json() == first
    assert stored(fake) == before


@pytest.mark.parametrize("status", ["AI Deliberated", "Underwriter Approved", "Declined", "Funded", "Closed"])
def test_submitting_in_a_later_status_is_409(fake, status):
    app_id = create(FULL_MORTGAGE).json()["id"]
    stored(fake)["status"] = status
    before = dict(stored(fake))
    r = submit(app_id)
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    assert status in r.json()["error"]["message"]
    assert stored(fake) == before


# AC4: nobody else can submit it


def test_another_borrower_gets_404_on_submit_and_nothing_changes(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    sign_in(fake, "borrower2", "borrower")
    r = submit(app_id)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert stored(fake)["status"] == "Draft"


@pytest.mark.parametrize("uid, role", [("broker1", "broker"), ("underwriter1", "underwriter")])
def test_staff_get_403_on_submit_and_nothing_changes(fake, uid, role):
    app_id = create(FULL_MORTGAGE).json()["id"]
    sign_in(fake, uid, role)
    r = submit(app_id)
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert stored(fake)["status"] == "Draft"


def test_submitting_an_unknown_id_is_404(fake):
    assert submit("nope").status_code == 404


def test_submit_needs_a_token():
    assert client.post("/core/applications/app1/submit").status_code == 401


# AC5: once submitted the borrower can't edit it


def test_once_submitted_edits_are_refused(fake):
    app_id = create(FULL_MORTGAGE).json()["id"]
    submit(app_id)
    before = dict(stored(fake))
    r = edit(app_id, {"term_years": 20})
    assert r.status_code == 409 and "Applied" in r.json()["error"]["message"]
    assert stored(fake) == before


def test_a_new_application_is_refused_while_one_is_submitted(fake):
    submit(create(FULL_MORTGAGE).json()["id"])
    assert create({"loan_type": "mortgage"}).status_code == 409


def test_openapi_lists_submit():
    spec = client.get("/core/openapi.json").json()
    post = spec["paths"]["/core/applications/{application_id}/submit"]["post"]
    assert "ApplicationOut" in str(post["responses"]["200"]) and "requestBody" not in post


# Nothing lands on a changed application: an edit racing a submit, or a submit racing an edit


def _another_request_in_between(monkeypatch, action):
    """Run `action` right after the next request has read the application and before it writes."""
    real = applications._own_application
    done = []

    def read_then_interrupt(app_id, uid):
        result = real(app_id, uid)
        if not done:
            done.append(True)
            action()
        return result

    monkeypatch.setattr(applications, "_own_application", read_then_interrupt)


def test_an_edit_that_races_a_submit_is_refused(fake, monkeypatch):
    app_id = create(FULL_MORTGAGE).json()["id"]
    _another_request_in_between(monkeypatch, lambda: submit(app_id))
    r = edit(app_id, {"term_years": 20})
    assert r.status_code == 409 and "changed" in r.json()["error"]["message"]
    assert stored(fake)["status"] == "Applied" and stored(fake)["termYears"] == 30


def test_a_submit_that_races_an_edit_is_refused(fake, monkeypatch):
    app_id = create(FULL_MORTGAGE).json()["id"]
    _another_request_in_between(monkeypatch, lambda: edit(app_id, {"gross_income_eur": None}))
    r = submit(app_id)
    assert r.status_code == 409
    assert stored(fake)["status"] == "Draft" and "grossIncomeEur" not in stored(fake)


def test_after_a_refused_race_trying_again_works(fake, monkeypatch):
    app_id = create(FULL_MORTGAGE).json()["id"]
    _another_request_in_between(monkeypatch, lambda: edit(app_id, {"term_years": 25}))
    assert submit(app_id).status_code == 409
    r = submit(app_id)
    assert r.status_code == 200 and r.json()["term_years"] == 25 and r.json()["status"] == "Applied"
