"""The fast-track fee (AL-72): POST /core/applications/{id}/fee-intent and POST /core/webhooks/stripe.

Stripe is replaced by a stand-in that remembers its intents. The webhook signature is checked for real, with a made-up secret, so
what the tests show about bad and good signatures is what Stripe's own library does.
"""

import hashlib
import hmac
import json
import time

import pytest
import stripe

from app import fees
from tests.test_applications import LATER, TOKEN, client, fake, sign_in  # noqa: F401

SECRET = "whsec_made_up_for_tests"
FEE_CENTS = 15000


class FakeStripe(fees.StripeGateway):
    """Real signature checking (read_event), with intents kept in memory instead of at Stripe."""

    def __init__(self):
        super().__init__("sk_test_made_up", SECRET)
        self.intents, self.created, self.retrieved, self.error = {}, [], [], None
        self.replaced = []  # the intent each create_intent call was told it replaces, in order
        self.create_status = "requires_payment_method"  # what a newly created intent comes back as (a replayed one may be "succeeded")

    def create_intent(self, application_id, borrower_id, replaces=None):
        if self.error:
            raise self.error
        self.created.append((application_id, borrower_id))
        self.replaced.append(replaces)
        intent = {"id": f"pi_{len(self.created)}", "client_secret": f"pi_{len(self.created)}_secret_x", "status": self.create_status}
        self.intents[intent["id"]] = intent
        return dict(intent)

    def retrieve_intent(self, intent_id):
        if self.error:
            raise self.error
        self.retrieved.append(intent_id)
        return dict(self.intents[intent_id])


@pytest.fixture
def stripe_fake(fake, monkeypatch):
    """Alice's Applied application app1, her signed-in session, and the fee code pointed at the in-memory Firestore and the stand-in."""
    monkeypatch.setattr(fees, "db", lambda: fake["db"])
    gateway = FakeStripe()
    monkeypatch.setattr(fees, "gateway", lambda: gateway)
    fake["db"].store["applications/app1"] = {"borrowerId": "borrower1", "brokerId": "broker1", "status": "Applied", "loanType": "mortgage"}
    fake["db"].versions["applications/app1"] = 1
    fake["stripe"] = gateway
    return fake


def doc(fake, app_id="app1"):
    return fake["db"].store[f"applications/{app_id}"]


def ask(app_id="app1"):
    return client.post(f"/core/applications/{app_id}/fee-intent", headers=TOKEN)


# ---- the payment intent -----------------------------------------------------------------------------------------------


def test_the_owner_gets_a_client_secret_for_150_euro_and_the_intent_is_saved(stripe_fake):
    r = ask()
    assert r.status_code == 200, r.json()
    assert r.json() == {"client_secret": "pi_1_secret_x", "payment_intent_id": "pi_1", "amount_eur": 150}
    assert stripe_fake["stripe"].created == [("app1", "borrower1")]
    assert doc(stripe_fake)["feeIntentId"] == "pi_1" and doc(stripe_fake)["feeStatus"] == "unpaid"
    assert "fastTrack" not in doc(stripe_fake) and "feePaidAt" not in doc(stripe_fake)


def test_asking_again_returns_the_same_intent_and_makes_no_new_one(stripe_fake):
    first, second = ask().json(), ask().json()
    assert first == second
    assert stripe_fake["stripe"].created == [("app1", "borrower1")] and stripe_fake["stripe"].retrieved == ["pi_1"]


def test_an_application_the_ai_has_deliberated_can_pay_too(stripe_fake):
    doc(stripe_fake)["status"] = "AI Deliberated"
    assert ask().status_code == 200


def test_a_cancelled_intent_is_replaced_by_a_new_one(stripe_fake):
    ask()
    stripe_fake["stripe"].intents["pi_1"]["status"] = "canceled"
    r = ask()
    assert r.status_code == 200 and r.json()["payment_intent_id"] == "pi_2"
    assert doc(stripe_fake)["feeIntentId"] == "pi_2"


def test_the_new_intent_is_made_knowing_which_cancelled_one_it_replaces(stripe_fake):
    ask()
    stripe_fake["stripe"].intents["pi_1"]["status"] = "canceled"
    ask()
    stripe_fake["stripe"].intents["pi_2"]["status"] = "canceled"
    ask()
    assert stripe_fake["stripe"].replaced == [None, "pi_1", "pi_2"]  # the first has nothing to replace


class Recorder:
    """Stands in for stripe.PaymentIntent.create on the REAL gateway and keeps what it was called with. The in-memory FakeStripe above
    ignores idempotency keys, which is how the key bug passed every test before."""

    def __init__(self):
        self.calls = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return {"id": f"pi_{len(self.calls)}", "client_secret": "secret", "status": "requires_payment_method"}


@pytest.fixture
def recorder(monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(stripe.PaymentIntent, "create", rec)
    return rec


def test_the_first_intent_for_an_application_uses_a_key_that_says_so(recorder):
    fees.StripeGateway("sk_test_x", SECRET, "ns").create_intent("app1", "borrower1")
    assert recorder.calls[0]["idempotency_key"] == "al-fee-ns-app1-first"


def test_replacing_a_cancelled_intent_uses_a_different_key_so_stripe_cannot_replay_the_cancelled_one(recorder):
    gateway = fees.StripeGateway("sk_test_x", SECRET, "ns")
    gateway.create_intent("app1", "borrower1")
    gateway.create_intent("app1", "borrower1", replaces="pi_1")
    gateway.create_intent("app1", "borrower1", replaces="pi_2")
    keys = [call["idempotency_key"] for call in recorder.calls]
    assert keys == ["al-fee-ns-app1-first", "al-fee-ns-app1-pi_1", "al-fee-ns-app1-pi_2"]
    assert len(set(keys)) == 3


def test_two_requests_to_replace_the_same_cancelled_intent_share_one_key_so_stripe_makes_one(recorder):
    gateway = fees.StripeGateway("sk_test_x", SECRET, "ns")
    gateway.create_intent("app1", "borrower1", replaces="pi_1")
    gateway.create_intent("app1", "borrower1", replaces="pi_1")
    assert recorder.calls[0]["idempotency_key"] == recorder.calls[1]["idempotency_key"]


def test_the_keys_of_two_applications_never_meet(recorder):
    gateway = fees.StripeGateway("sk_test_x", SECRET, "ns")
    gateway.create_intent("app1", "borrower1")
    gateway.create_intent("app2", "borrower1")
    assert recorder.calls[0]["idempotency_key"] != recorder.calls[1]["idempotency_key"]


# ---- the key names its environment (AL-323) ---------------------------------------------------------------------------------------


def test_two_environments_on_one_sandbox_never_share_a_key_for_the_same_application(recorder):
    """The bug: every developer's emulator has app-applied, and the team shares one Stripe sandbox."""
    fees.StripeGateway("sk_test_x", SECRET, "dev-one").create_intent("app-applied", "borrower1")
    fees.StripeGateway("sk_test_x", SECRET, "dev-two").create_intent("app-applied", "borrower1")
    assert recorder.calls[0]["idempotency_key"] != recorder.calls[1]["idempotency_key"]


def test_a_real_project_uses_its_project_id_so_every_task_of_the_service_agrees(recorder):
    env = {"STRIPE_SECRET_KEY": "sk_test_abc", "STRIPE_WEBHOOK_SECRET": "whsec_x", "FIREBASE_PROJECT_ID": "agentic-lender-a0f1c"}
    task_one, task_two = fees.StripeGateway.from_env(env), fees.StripeGateway.from_env(env)
    task_one.create_intent("app1", "borrower1")
    task_two.create_intent("app1", "borrower1")  # a double click that reached another task
    assert recorder.calls[0]["idempotency_key"] == recorder.calls[1]["idempotency_key"] == "al-fee-agentic-lender-a0f1c-app1-first"


@pytest.mark.parametrize("env", [{"FIREBASE_PROJECT_ID": "demo-al"}, {"FIREBASE_PROJECT_ID": "demo-anything"}, {"FIREBASE_PROJECT_ID": ""}, {}])
def test_an_emulator_project_or_none_uses_a_random_value_for_this_process(env):
    assert fees.key_namespace(env) == fees.PROCESS_NAMESPACE
    assert len(fees.PROCESS_NAMESPACE) == 8


def test_the_explicit_setting_wins_over_the_project_id():
    assert fees.key_namespace({"STRIPE_KEY_NAMESPACE": "team-a", "FIREBASE_PROJECT_ID": "agentic-lender-a0f1c"}) == "team-a"
    assert fees.key_namespace({"STRIPE_KEY_NAMESPACE": "team-a", "FIREBASE_PROJECT_ID": "demo-al"}) == "team-a"


def test_the_namespace_is_cleaned_so_it_cannot_break_the_key():
    assert fees.key_namespace({"STRIPE_KEY_NAMESPACE": "my project/1"}) == "my-project-1"
    assert fees.key_namespace({"STRIPE_KEY_NAMESPACE": "a b.c"}) == "a-b-c"
    assert fees.key_namespace({"STRIPE_KEY_NAMESPACE": "x" * 500}) == "x" * 60  # Stripe's key limit is 255; leave room for the rest


def test_two_processes_on_emulators_get_different_namespaces():
    """Two developers' API processes: each picks its own value when it starts."""
    import subprocess
    import sys
    from pathlib import Path

    project_dir = Path(fees.__file__).resolve().parent.parent
    code = "from app.fees import key_namespace; print(key_namespace({'FIREBASE_PROJECT_ID': 'demo-al'}))"
    runs = [subprocess.run([sys.executable, "-c", code], cwd=project_dir, capture_output=True, text=True, check=True).stdout.strip() for _ in range(2)]
    assert len(runs[0]) == len(runs[1]) == 8 and runs[0] != runs[1]


def test_a_new_intent_that_comes_back_already_paid_is_409_and_nothing_is_saved_or_sent(stripe_fake):
    stripe_fake["stripe"].create_status = "succeeded"  # what a replayed request returned on the shared sandbox
    r = ask()
    assert r.status_code == 409 and "confirmed" in r.json()["error"]["message"]
    assert "client_secret" not in r.text and "secret_x" not in r.text
    assert "feeIntentId" not in doc(stripe_fake) and "feeStatus" not in doc(stripe_fake)


def test_a_new_intent_that_comes_back_cancelled_is_refused_and_nothing_is_saved_or_sent(stripe_fake):
    stripe_fake["stripe"].create_status = "canceled"
    r = ask()
    assert r.status_code == 502 and "secret_x" not in r.text
    assert "feeIntentId" not in doc(stripe_fake) and "feeStatus" not in doc(stripe_fake)


@pytest.mark.parametrize("status", ["requires_payment_method", "requires_confirmation", "requires_action", "processing"])
def test_a_new_intent_that_is_still_open_is_saved_and_returned_as_before(stripe_fake, status):
    stripe_fake["stripe"].create_status = status
    r = ask()
    assert r.status_code == 200 and r.json()["payment_intent_id"] == "pi_1"
    assert doc(stripe_fake)["feeIntentId"] == "pi_1" and doc(stripe_fake)["feeStatus"] == "unpaid"


def test_a_payment_that_went_through_but_is_not_recorded_yet_is_409(stripe_fake):
    ask()
    stripe_fake["stripe"].intents["pi_1"]["status"] = "succeeded"
    r = ask()
    assert r.status_code == 409 and "confirmed" in r.json()["error"]["message"]


@pytest.mark.parametrize("status", ["Draft", "Underwriter Approved", "Declined", "Funded", "Closed"])
def test_only_a_submitted_application_that_is_not_decided_can_pay(stripe_fake, status):
    doc(stripe_fake)["status"] = status
    r = ask()
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    assert stripe_fake["stripe"].created == [] and "feeIntentId" not in doc(stripe_fake)


def test_an_application_already_paid_is_409_and_no_intent_is_made(stripe_fake):
    doc(stripe_fake).update({"feeStatus": "paid", "feeIntentId": "pi_old"})
    r = ask()
    assert r.status_code == 409 and "already paid" in r.json()["error"]["message"]
    assert stripe_fake["stripe"].created == [] and stripe_fake["stripe"].retrieved == []


def test_someone_elses_or_an_unknown_application_is_404(stripe_fake):
    doc(stripe_fake)["borrowerId"] = "borrower2"
    assert ask().status_code == 404 and ask("nope").status_code == 404
    assert stripe_fake["stripe"].created == []


def test_only_a_borrower_can_ask(stripe_fake):
    for role in ("broker", "underwriter"):
        sign_in(stripe_fake, "u1", role)
        assert ask().status_code == 403
    assert client.post("/core/applications/app1/fee-intent").status_code == 401


def test_if_stripe_is_down_it_is_502_and_nothing_is_saved(stripe_fake):
    stripe_fake["stripe"].error = stripe.APIConnectionError("no route to Stripe")
    r = ask()
    assert r.status_code == 502
    assert "feeIntentId" not in doc(stripe_fake) and "feeStatus" not in doc(stripe_fake)


def test_without_stripe_settings_it_is_503(fake, monkeypatch):
    for name in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"):
        monkeypatch.delenv(name, raising=False)
    fake["db"].store["applications/app1"] = {"borrowerId": "borrower1", "status": "Applied"}
    r = ask()
    assert r.status_code == 503 and "not set up" in r.json()["error"]["message"]


@pytest.mark.parametrize("key", ["sk_live_abc", "pk_test_abc", "abc"])
def test_only_test_keys_are_accepted(key):
    with pytest.raises(fees.NotConfigured):
        fees.StripeGateway.from_env({"STRIPE_SECRET_KEY": key, "STRIPE_WEBHOOK_SECRET": "whsec_x"})


def test_a_test_key_is_accepted():
    gateway = fees.StripeGateway.from_env({"STRIPE_SECRET_KEY": "sk_test_abc", "STRIPE_WEBHOOK_SECRET": "whsec_x"})
    assert gateway.secret_key == "sk_test_abc"


# ---- the webhook ------------------------------------------------------------------------------------------------------------


def event(intent_id="pi_1", application_id="app1", amount=FEE_CENTS, currency="eur", status="succeeded", kind="payment_intent.succeeded"):
    return {
        "id": "evt_1", "object": "event", "type": kind,
        "data": {"object": {"id": intent_id, "object": "payment_intent", "amount": amount, "currency": currency, "status": status,
                            "metadata": {"application_id": application_id}}},
    }


def signed(body: bytes, secret=SECRET, timestamp=None):
    timestamp = int(time.time()) if timestamp is None else timestamp
    digest = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def send(payload=None, signature="auto", raw=None):
    body = raw if raw is not None else json.dumps(payload if payload is not None else event()).encode()
    headers = {"Content-Type": "application/json"}
    if signature == "auto":
        signature = signed(body)
    if signature is not None:
        headers["Stripe-Signature"] = signature
    return client.post("/core/webhooks/stripe", content=body, headers=headers)  # no Authorization header: Stripe has none


@pytest.fixture
def waiting(stripe_fake):
    """An application with an open, unpaid intent pi_1."""
    ask()
    return stripe_fake


def test_a_signed_success_marks_the_fee_paid_and_the_application_fast_track_in_one_write(waiting):
    r = send()
    assert r.status_code == 200 and r.json() == {"received": True}
    assert doc(waiting)["feeStatus"] == "paid" and doc(waiting)["fastTrack"] is True
    assert doc(waiting)["feePaidAt"] == LATER and doc(waiting)["feeIntentId"] == "pi_1"
    assert doc(waiting)["status"] == "Applied"  # paying changes nothing else


def test_no_signature_is_400_and_nothing_changes(waiting):
    r = send(signature=None)
    assert r.status_code == 400 and r.json()["error"]["code"] == "BAD_REQUEST"
    assert doc(waiting)["feeStatus"] == "unpaid" and "fastTrack" not in doc(waiting)


@pytest.mark.parametrize("signature", ["", "garbage", "t=1,v1=abc", "v1=abc"])
def test_a_malformed_signature_is_400(waiting, signature):
    assert send(signature=signature).status_code == 400
    assert doc(waiting)["feeStatus"] == "unpaid"


def test_a_signature_made_with_another_secret_is_400(waiting):
    body = json.dumps(event()).encode()
    assert send(raw=body, signature=signed(body, secret="whsec_someone_else")).status_code == 400
    assert doc(waiting)["feeStatus"] == "unpaid"


def test_a_body_changed_after_signing_is_400(waiting):
    good = json.dumps(event(amount=100)).encode()
    forged = json.dumps(event(amount=FEE_CENTS)).encode()
    assert send(raw=forged, signature=signed(good)).status_code == 400
    assert doc(waiting)["feeStatus"] == "unpaid"


def test_an_old_signature_is_400_so_a_captured_call_cannot_be_replayed_later(waiting):
    body = json.dumps(event()).encode()
    assert send(raw=body, signature=signed(body, timestamp=int(time.time()) - 3600)).status_code == 400
    assert doc(waiting)["feeStatus"] == "unpaid"


@pytest.mark.parametrize(
    "changes",
    [{"amount": 100}, {"amount": FEE_CENTS + 1}, {"currency": "usd"}, {"status": "requires_payment_method"}, {"intent_id": "pi_other"}],
)
def test_a_payment_that_is_not_this_fee_is_acknowledged_and_changes_nothing(waiting, changes):
    r = send(event(**changes))
    assert r.status_code == 200
    assert doc(waiting)["feeStatus"] == "unpaid" and "fastTrack" not in doc(waiting)


def test_a_payment_for_an_unknown_application_is_acknowledged_and_ignored(waiting):
    assert send(event(application_id="nope")).status_code == 200
    assert doc(waiting)["feeStatus"] == "unpaid"


def test_a_payment_with_no_application_in_its_metadata_is_ignored(waiting):
    body = event()
    body["data"]["object"]["metadata"] = {}
    assert send(body).status_code == 200 and doc(waiting)["feeStatus"] == "unpaid"


def test_a_payment_for_an_application_with_no_saved_intent_is_409_so_stripe_sends_it_again(stripe_fake):
    r = send()
    assert r.status_code == 409
    assert "feeStatus" not in doc(stripe_fake)


def test_other_event_types_are_acknowledged_and_ignored(waiting):
    assert send(event(kind="payment_intent.payment_failed", status="requires_payment_method")).status_code == 200
    assert send(event(kind="charge.refunded")).status_code == 200
    assert doc(waiting)["feeStatus"] == "unpaid"


def test_the_same_event_twice_pays_once(waiting):
    send()
    doc(waiting)["feePaidAt"] = "kept"  # a second delivery must not move the time
    assert send().status_code == 200
    assert doc(waiting)["feePaidAt"] == "kept"


def test_two_deliveries_at_the_same_moment_pay_once_and_the_second_does_not_move_the_paid_time(waiting, monkeypatch):
    """Both deliveries read "unpaid". The first one's write lands between the second's read and write; Firestore refuses the second's
    write because the application changed since it read it, and it reads again, sees "paid" and stops."""
    database = waiting["db"]
    doc_class = database.collection("applications").document("app1").__class__
    real_get, reads = doc_class.get, []

    def get_then_let_the_other_delivery_win(self):
        snap = real_get(self)
        reads.append(snap.to_dict().get("feeStatus"))
        if len(reads) == 1:  # the other delivery's write lands right after this read
            # A new dict, as a real write would be: the snapshot already read must stay as it was, "unpaid".
            database.store["applications/app1"] = {**database.store["applications/app1"], "feeStatus": "paid", "feePaidAt": "first", "fastTrack": True}
            database.versions["applications/app1"] += 1
        return snap

    monkeypatch.setattr(doc_class, "get", get_then_let_the_other_delivery_win)
    assert send().status_code == 200
    assert reads == ["unpaid", "paid"]  # it read again after the refused write
    assert doc(waiting)["feePaidAt"] == "first"  # not moved to the later time


def test_an_application_that_keeps_changing_under_the_webhook_is_409_so_stripe_sends_it_again(waiting, monkeypatch):
    database = waiting["db"]
    doc_class = database.collection("applications").document("app1").__class__
    real_get = doc_class.get

    def get_then_change_it(self):
        snap = real_get(self)
        database.versions["applications/app1"] += 1  # something else wrote after every read
        return snap

    monkeypatch.setattr(doc_class, "get", get_then_change_it)
    r = send()
    assert r.status_code == 409
    assert doc(waiting)["feeStatus"] == "unpaid" and "fastTrack" not in doc(waiting)


def test_a_paid_application_stays_paid_even_if_it_has_been_decided_since(waiting):
    doc(waiting)["status"] = "Declined"
    send()
    assert doc(waiting)["feeStatus"] == "paid" and doc(waiting)["status"] == "Declined"


def test_the_webhook_without_stripe_settings_is_503(fake, monkeypatch):
    for name in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"):
        monkeypatch.delenv(name, raising=False)
    assert client.post("/core/webhooks/stripe", content=b"{}").status_code == 503


def test_a_borrower_cannot_mark_their_own_fee_paid_by_editing_a_draft(stripe_fake):
    # An Applied application is refused any edit (409), so that would prove nothing. A Draft takes edits: the fee fields must still not get through.
    doc(stripe_fake)["status"] = "Draft"
    r = client.patch("/core/applications/app1", json={"feeStatus": "paid", "feeIntentId": "pi_mine", "fastTrack": True}, headers=TOKEN)
    assert r.status_code in (200, 422), r.json()  # the edit route was reached, not turned away as a 409
    for field in ("feeStatus", "feeIntentId", "feePaidAt", "fastTrack"):
        assert field not in doc(stripe_fake)
