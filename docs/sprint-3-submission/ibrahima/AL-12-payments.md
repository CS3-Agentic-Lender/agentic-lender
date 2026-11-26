# Use case: AL-12 Payments

## Overview

| Item | Detail |
|---|---|
| Epic | AL-12 Payments |
| Feature (from the brief) | "Mobile: Payments: fast-track appraisal processing or application verification fee via Stripe Sandbox or PayPal Sandbox." |
| Owner | Ibrahima Toure (iOS, AL-148). The fee intent and webhook are Dumi's (AL-72, AL-322, AL-323); fast-track first in the queue is Nikoloz's (AL-319). |
| Sprint | Sprint 3 (16 to 28 Nov 2026). |
| Decisions | Stripe Sandbox, not PayPal. EUR 150, as in the Figma payment frames. Fast-track flags the application so it sorts first in the underwriter queue. |
| Wireframes | Figma payment frames 16 to 18c. Also `AL-44/wireframe.png` in this folder. |

## Goal

As a borrower, I want my property appraisal done faster, so I pay a €150 fast-track fee.

## Actors

- **Borrower:** signed in to the iOS app, with a submitted application.
- **Stripe (test mode):** takes the card in its payment sheet and sends a webhook.
- **al-core:** creates the payment intent, checks Stripe's webhook signature, and marks the fee paid and the application fast-track.
- **Underwriter:** sees fast-track applications first in the portal's queue.

## Preconditions

- The borrower is signed in and has submitted an application that hasn't been decided yet.
- The app has Stripe's publishable test key (`pk_test_…`); al-core has the secret key and the webhook secret.

**Trigger:** on the status screen, the borrower taps See details on the "Speed up your valuation" card.

## Main flow

1. The app shows the Fast-track appraisal screen with a Test mode badge: a valuer visits within 5 working days, the valuation goes straight into the application, the broker is told as soon as the borrower pays, and the application moves to the top of the underwriter's queue. One-off fee €150.00.
2. The borrower taps Pay €150.00. The app asks al-core for a payment intent.
3. al-core creates the intent with Stripe and returns it. The app opens Stripe's payment sheet.
4. The borrower enters a card and pays in the sheet.
5. The app shows "Confirming your payment" while it waits for al-core.
6. Stripe sends al-core a webhook. al-core checks the signature, the intent, the amount (€150) and the currency (`eur`), then marks the fee paid and the application fast-track.
7. The app sees the fee marked paid and shows the receipt: Payment received, €150.00, Fast-track appraisal, the application reference, the date and the payment reference.
8. Back on the status screen, the card reads "Fast-track paid" with the date and View receipt.
9. In the portal, the application sorts first in the underwriter's queue with a Fast-track badge.

## Alternative flows

- **A. Card declined.** At step 4, Stripe refuses the card and says so in its sheet ("Your card was declined."). The sheet stays open, the fee stays unpaid, and the borrower can try another card on the same payment.
- **B. Not now.** At step 1 the borrower taps Not now; nothing is charged and the offer stays on the status screen.
- **C. Decided before paying.** If the underwriter decides the application while the fee screen is open, the screen switches to "Fast-track no longer applies": "Your application has already been decided, so fast-track no longer applies. Nothing was charged."
- **D. Already paid.** If al-core already has a successful payment for this application (for example the app closed before the webhook arrived), the app waits for the webhook and shows the receipt instead of charging again.

## Exceptions

- The payment can't start (no connection, or al-core refuses): "We couldn't start the payment. Nothing was charged. Try again." and the button reads Try again.
- The webhook is slow: after 20 seconds the app says "Still waiting. You won't be charged twice." with Check again.
- The borrower closes Stripe's sheet: back to the fee screen, nothing charged.

## Postconditions

- **Success:** in Firestore the application has `feeStatus: paid`, `feePaidAt` and `fastTrack: true`; its status doesn't change. It sorts first in the underwriter's queue.
- **Declined or not now:** the fee stays `unpaid` and the offer stays on the status screen.

## Business rules

- Stripe test mode only. The app holds only the publishable test key; the secret key is never in the app or the repo.
- The fee is marked paid only by al-core's webhook, never by the app, and only when the payment succeeded and its intent id, amount (€150) and currency (`eur`) match what al-core stored.
- The fee is offered only until the application is decided.

## Stories in this epic

| Story | Title | Owner | Status |
|---|---|---|---|
| AL-44 | As a borrower, I pay a fast-track appraisal fee through Stripe Sandbox | Ibrahima | Done |
