"""The fast-track appraisal fee: a Stripe test payment, and a webhook that is the only thing that marks it paid (AL-72).

POST /core/applications/{id}/fee-intent
    The borrower who owns a submitted application asks for a Stripe payment intent for EUR 150 and gets its client secret back, for the
    app's payment sheet. The intent's id is saved on the application as `feeIntentId`, with `feeStatus` `unpaid`. Asking again returns the
    same intent, so a borrower who leaves the sheet and comes back pays once. A Draft, a decided application, or one that is already paid is 409.

POST /core/webhooks/stripe
    Stripe calls this, with no Firebase token. The request is believed only when Stripe's signature on the raw body checks out. On
    `payment_intent.succeeded` for the saved intent, EUR 150, the application gets `feeStatus` `paid`, `feePaidAt` and `fastTrack` true in one
    write. No client can write those fields (firestore.rules), and nothing else here writes them, so a fee is never paid without a payment.

Only Stripe test keys are accepted: a live key is refused, so this can never take real money. The keys come from the environment
(STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET), never from a request or the repo.
"""

import json
import logging
import os
import re
import secrets

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from google.api_core.exceptions import FailedPrecondition
from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.applications import _own_application
from app.auth import require_role
from app.firestore import db

log = logging.getLogger("al-core.fees")
router = APIRouter(prefix="/core", tags=["fees"])

FEE_EUR = 150
FEE_CENTS = FEE_EUR * 100
CURRENCY = "eur"
# The fee is for an application that has been sent and not yet decided; a Draft has nothing to speed up, and a decided one is past it.
PAYABLE_STATUSES = ("Applied", "AI Deliberated")
# How many times a webhook re-reads an application that keeps changing under it before it asks Stripe to send the event again.
WEBHOOK_ATTEMPTS = 3
# A value that is different in every process that starts. Every developer's emulators run under the same project id (demo-al) and the
# same seeded application ids, and the team shares one Stripe sandbox, so the idempotency key needs something that tells them apart.
PROCESS_NAMESPACE = secrets.token_hex(4)


def key_namespace(env=None) -> str:
    """The part of the idempotency key that says which environment a request comes from.

    STRIPE_KEY_NAMESPACE wins if it is set. On a real Firebase project it is the project id, which is the same on every task of the
    deployed service, so two requests that reach two tasks at the same moment still make one intent. On the emulators (a `demo-` project,
    or none) it is a random value for this process, so two developers on one Stripe sandbox cannot be handed each other's intents.
    """
    env = os.environ if env is None else env
    chosen = (env.get("STRIPE_KEY_NAMESPACE") or "").strip()
    if not chosen:
        project = (env.get("FIREBASE_PROJECT_ID") or "").strip()
        chosen = project if project and not project.startswith("demo-") else PROCESS_NAMESPACE
    return re.sub(r"[^A-Za-z0-9_-]", "-", chosen)[:60]  # Stripe's key limit is 255 characters


class FeeIntentOut(BaseModel):
    client_secret: str
    payment_intent_id: str
    amount_eur: int


class NotConfigured(Exception):
    """The Stripe settings are missing or are not test keys."""


class StripeGateway:
    """The two things the fee needs from Stripe. A stand-in with the same three methods is used in tests, so none of them calls Stripe."""

    def __init__(self, secret_key: str, webhook_secret: str, namespace: str = "default"):
        self.secret_key, self.webhook_secret, self.namespace = secret_key, webhook_secret, namespace

    @classmethod
    def from_env(cls, env=None) -> "StripeGateway":
        env = os.environ if env is None else env
        secret, webhook = (env.get("STRIPE_SECRET_KEY") or "").strip(), (env.get("STRIPE_WEBHOOK_SECRET") or "").strip()
        if not secret or not webhook:
            raise NotConfigured("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are not set")
        if not secret.startswith(("sk_test_", "rk_test_")):
            raise NotConfigured("STRIPE_SECRET_KEY is not a Stripe test key; only test keys are allowed")
        return cls(secret, webhook, key_namespace(env))

    def create_intent(self, application_id: str, borrower_id: str, replaces: str | None = None) -> dict:
        """A new EUR 150 intent. The idempotency key makes two calls at the same moment return one intent.

        Stripe replays the saved answer to a repeated key for 24 hours, so the key has to change when the borrower needs a different
        intent: a cancelled one is replaced by an intent made under a key that names the cancelled one (`replaces`). Without that, the
        new request would get the cancelled intent straight back and the borrower could never pay.

        The key also names the environment (`self.namespace`, see `key_namespace`): without it, everyone on the shared sandbox who asks for
        a fee on the same seeded application id would be handed the first person's intent, already paid.
        """
        intent = stripe.PaymentIntent.create(
            amount=FEE_CENTS,
            currency=CURRENCY,
            automatic_payment_methods={"enabled": True, "allow_redirects": "never"},  # cards only: no redirect page to come back from
            description=f"Fast-track appraisal fee, application {application_id}",
            metadata={"application_id": application_id, "borrower_id": borrower_id},
            idempotency_key=f"al-fee-{self.namespace}-{application_id}-{replaces or 'first'}",
            api_key=self.secret_key,
        )
        return {"id": intent["id"], "client_secret": intent["client_secret"], "status": intent["status"]}

    def retrieve_intent(self, intent_id: str) -> dict:
        intent = stripe.PaymentIntent.retrieve(intent_id, api_key=self.secret_key)
        return {"id": intent["id"], "client_secret": intent["client_secret"], "status": intent["status"]}

    def read_event(self, payload: bytes, signature: str) -> dict:
        """The event in the body, but only if Stripe's signature on exactly these bytes is valid and recent. Otherwise ValueError."""
        try:
            stripe.Webhook.construct_event(payload, signature, self.webhook_secret)
        except (stripe.SignatureVerificationError, ValueError) as exc:
            raise ValueError(str(exc)) from None
        return json.loads(payload)


def gateway():
    try:
        return StripeGateway.from_env()
    except NotConfigured as exc:
        raise HTTPException(503, f"Payments are not set up on this server: {exc}")


@router.post("/applications/{application_id}/fee-intent", response_model=FeeIntentOut)
def create_fee_intent(application_id: str, user: dict = Depends(require_role("borrower"))):
    """A Stripe payment intent for the fee, for the borrower's own submitted application. The same intent again if one is open.

    Someone else's application is 404, a Draft or a decided one is 409, and an application already paid is 409. If Stripe cannot be
    reached it is 502, and nothing is saved.
    """
    ref, doc, _ = _own_application(application_id, user["uid"])
    status = doc.get("status")
    if doc.get("feeStatus") == "paid":
        raise HTTPException(409, "The fee for this application is already paid")
    if status == "Draft":
        raise HTTPException(409, "Submit the application before paying the fast-track fee")
    if status not in PAYABLE_STATUSES:
        raise HTTPException(409, f"The fast-track fee can only be paid while an application is Applied or AI Deliberated; this one is {status}")

    stripe_gateway = gateway()
    try:
        intent, replaces = None, None
        if doc.get("feeIntentId"):
            intent = stripe_gateway.retrieve_intent(doc["feeIntentId"])
            if intent["status"] == "succeeded":
                raise HTTPException(409, "The payment went through and is being confirmed")
            if intent["status"] == "canceled":
                replaces, intent = doc["feeIntentId"], None  # an intent that can't be paid any more, so make a new one
        if intent is None:
            intent = stripe_gateway.create_intent(application_id, user["uid"], replaces)
            # A new intent should be open. If Stripe hands back one that is not (a replay of an earlier request), it must not be saved or
            # sent to the app: the payment sheet would refuse it.
            if intent["status"] == "succeeded":
                raise HTTPException(409, "The payment went through and is being confirmed")
            if intent["status"] == "canceled":
                raise HTTPException(502, "The payment service returned a payment that can no longer be paid. Try again")
    except stripe.StripeError as exc:
        log.warning("Stripe failed for application %s: %s", application_id, type(exc).__name__)
        raise HTTPException(502, "The payment service could not be reached. Try again")

    if doc.get("feeIntentId") != intent["id"] or doc.get("feeStatus") != "unpaid":
        ref.update({"feeIntentId": intent["id"], "feeStatus": "unpaid"})
    return FeeIntentOut(client_secret=intent["client_secret"], payment_intent_id=intent["id"], amount_eur=FEE_EUR)


def _mark_paid(intent: dict) -> None:
    """Pay the fee for the application this intent belongs to, if everything checks out. Anything else is left alone.

    A webhook that cannot be acted on for good (no such application, another intent, wrong amount) is acknowledged, because Stripe would
    otherwise send it again for days. One that may only be early (the application has no saved intent yet) is refused with 409, so Stripe
    sends it again.
    """
    application_id = (intent.get("metadata") or {}).get("application_id")
    if intent.get("status") != "succeeded" or intent.get("amount") != FEE_CENTS or intent.get("currency") != CURRENCY or not application_id:
        log.warning("Ignored a payment that is not the fee: %s", intent.get("id"))
        return
    ref = db().collection("applications").document(application_id)
    for _ in range(WEBHOOK_ATTEMPTS):
        snap = ref.get()
        if not snap.exists:
            log.warning("Ignored payment %s: no application %s", intent.get("id"), application_id)
            return
        doc = snap.to_dict()
        stored = doc.get("feeIntentId")
        if not stored:
            raise HTTPException(409, "The application has no saved payment yet; try again")
        if stored != intent.get("id"):
            log.warning("Ignored payment %s: application %s expects %s", intent.get("id"), application_id, stored)
            return
        if doc.get("feeStatus") == "paid":
            return  # Stripe sends an event more than once at times
        try:
            # Firestore refuses this write if the application changed since the read above. Two deliveries of one event at the
            # same moment both read "unpaid", the first write wins, and the second is refused, reads again, sees "paid" and stops,
            # so the paid time is set once and never moved.
            changes = {"feeStatus": "paid", "feePaidAt": SERVER_TIMESTAMP, "fastTrack": True}
            ref.update(changes, option=db().write_option(last_update_time=snap.update_time))
            return
        except FailedPrecondition:
            continue
    raise HTTPException(409, "The application kept changing; try again")  # Stripe sends the event again


def _handle(payload: bytes, signature: str) -> dict:
    try:
        event = gateway().read_event(payload, signature)
    except ValueError:
        raise HTTPException(400, "The Stripe signature is missing or does not match")
    if event.get("type") == "payment_intent.succeeded":
        _mark_paid((event.get("data") or {}).get("object") or {})
    return {"received": True}


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    """Stripe's call when a payment changes. There is no Firebase token: the signature on the raw body is the proof it is Stripe."""
    payload = await request.body()
    return await run_in_threadpool(_handle, payload, request.headers.get("stripe-signature", ""))
