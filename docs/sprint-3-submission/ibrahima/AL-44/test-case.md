# Test case: AL-44

**Story:** As a borrower, I pay a fast-track appraisal fee through Stripe Sandbox

**Tested by:** Ibrahima Toure  
**Date run:** 23 Nov 2026 (hosted build); 18 Nov 2026 (local stack)  
**Build:** `main` with #242 merged; the hosted demo build (`AL_BACKEND=HOSTED`) on 23 Nov

## Preconditions

- **23 Nov, hosted:** the demo build on the iPhone 17 simulator against the hosted Firebase project, the API on AWS (`api.agentic-lender.com`) and the team's Stripe sandbox, with only a `pk_test_` key in the gitignored `Config/Hosted.xcconfig`. A borrower with a fresh application, reference `eLdeUNTF`, made-up figures.
- **18 Nov, local:** the emulators, al-core on the Docker stack with the Stripe test secret key, `stripe listen` forwarding the webhook, signed in as Alice.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Submit an application, open its status screen, tap See details on the "Speed up your valuation" card, then tap Pay €150.00. | The fast-track appraisal is offered for EUR 150; Pay opens Stripe's payment sheet in test mode. | FeeTests (intent decoding) | ☑ Pass ☐ Fail |
| 2 | 3 | Pay with the declined test card 4000 0000 0000 0002. | "Card declined" shows and the fee stays unpaid. | FeeTests (the sheet's failure reason) | ☑ Pass ☐ Fail |
| 3 | 2 | In the same sheet, pay with the success card 4242 4242 4242 4242. | The backend webhook marks the fee paid (not the app) and a receipt shows. | FeeTests (waiting for the webhook, the receipt) | ☑ Pass ☐ Fail |
| 4 | 4 | Check which Stripe keys the app and the repo hold. | Only test keys; the secret key is never in the app or the repo. | betterleaks on every commit | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`), iPhone 17 simulator: 756 passed, 0 failed on #242's branch (18 Nov); 786 passed, 0 failed on `main` + AL-320 (`23b9825`, 23 Nov). The 8 end-to-end UI tests passed on the local stack on both dates.

## Notes

- Step 1 (23 Nov): "Fast-track appraisal", one-off fee €150.00, with a Test mode badge; Pay €150.00 opened Stripe's sheet.
- Step 2 (23 Nov): the sheet said "Your card was declined." and stayed open, so the borrower can try another card; the fee stayed unpaid. On 18 Nov the backend logged `payment_intent.payment_failed` → 200 and Firestore kept `unpaid`. The wording is Stripe's own, not the criterion's "Card declined".
- Step 3 (23 Nov): "Payment received" receipt: €150.00, Fast-track appraisal, application `eLdeUNTF`, payment reference `pi_…q4J8`. The status screen then showed "Fast-track paid · 23 Nov" with View receipt. The app shows the receipt only after al-core's Stripe webhook has marked the fee paid. On 18 Nov: `payment_intent.succeeded` → webhook 200; Firestore `feeStatus: paid`, `feePaidAt`, `fastTrack: true`, on the same intent as the declined attempt. The wording is "Payment received" / "Fast-track paid" (Figma 18 and 18a), not the criterion's "Fee paid: fast-track".
- Step 4: the app holds only the `pk_test_` publishable key from the gitignored hosted config. A scan of every tracked file and of the built app found no `sk_test_` or `sk_live_` key (23 Nov).
- Full write-up and screenshots: the AL-44 comment of 23 Nov and the Sprint 3 summary page in Confluence.
