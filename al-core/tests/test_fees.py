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

    def create_intent(self, application_id, borrower_id):
        if self.error:
            raise self.error
        self.created.append((application_id, borrower_id))
        intent = {"id": f"pi_{len(self.created)}", "client_secret": f"pi_{len(self.created)}_secret_x", "status": "requires_payment_method"}
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


def test_a_paid_application_stays_paid_even_if_it_has_been_decided_since(waiting):
    doc(waiting)["status"] = "Declined"
    send()
    assert doc(waiting)["feeStatus"] == "paid" and doc(waiting)["status"] == "Declined"


def test_the_webhook_without_stripe_settings_is_503(fake, monkeypatch):
    for name in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"):
        monkeypatch.delenv(name, raising=False)
    assert client.post("/core/webhooks/stripe", content=b"{}").status_code == 503


def test_a_borrower_cannot_mark_their_own_fee_paid_through_any_route(waiting):
    # The fee fields are written by the webhook only: the edit and submit routes ignore them.
    for path in ("/core/applications/app1",):
        client.patch(path, json={"feeStatus": "paid", "fastTrack": True}, headers=TOKEN)
    assert doc(waiting)["feeStatus"] == "unpaid" and "fastTrack" not in doc(waiting)
