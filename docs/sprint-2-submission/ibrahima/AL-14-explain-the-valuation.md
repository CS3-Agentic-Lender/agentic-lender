# Use case: AL-14 Explain the valuation

**Epic AL-14 Explain the valuation (our custom feature).** The property valuation breakdown explains how individual property details influence the estimated value, rather than showing borrowers just one unexplained figure. We picked it as our custom feature because it adds transparency to the valuation and helps users understand what drives the estimate.

## Overview

| | |
|---|---|
| Epic | [AL-14](https://alprojectcs3.atlassian.net/browse/AL-14) |
| Feature (from the brief) | Custom Feature Requirement: each group implements at least one custom feature of its own. Ours is an explainable valuation, shown in AL-Mobile and AL-Web, worked out in the AL-AI engine. |
| Owner | Use case: Ibrahima. The breakdown in the API is Nic's (al-ai, AL-131), the borrower's screen is Ibrahima's (iOS, AL-132), and the loan-file chart is Nikoloz's (portal, AL-133). |
| Sprint | Sprint 2 (27 Oct to 15 Nov 2026). |
| Wireframes | Borrower app Figma, frames 11 (result) and 11e (breakdown, scrolled): `AL-132/wireframe.png` in this folder. The portal's chart goes in the V2 Property Intelligence frame (AL-133). |

**Built in Sprint 2.** al-ai returns the breakdown with every estimate (AL-131, Done), and the borrower app shows it on the property result (AL-132, Done). The portal's loan-file chart (AL-133) is In Review on 10 Nov: the chart is merged (AL-137, #140) and the low-support warnings beside it are in review.

## Goal

As a borrower or underwriter, I want to see why the model valued a house the way it did, so that I can trust the estimate or challenge it.

## How to read the numbers

The baseline (€577k) is the starting reference value used by the model. Each detail then adjusts that figure up or down. For example, "−€93,000 for County: Cork" means the model estimates that the location reduces the starting value by €93,000 compared with its reference assumptions. It isn't a separate fee or a guaranteed loss in property value.

## Actors

- **Borrower:** signed in to the iOS app, checking a property.
- **Underwriter:** signed in to the portal, reviewing a loan file (AL-133).
- **al-ai** (the AI API): `POST /ai/valuation` returns the estimate and its breakdown.
- **Valuation model (v2):** the saved model, with a fixed background sample of 100 training homes that the breakdown is measured against.

## Preconditions and trigger

- The user is signed in (Firebase Auth) and every request carries their Firebase ID token.
- al-ai is running behind the gateway, with the saved model and its background sample loaded.
- The home's details are filled in: county, floor area, bedrooms, property type, BER and Eircode.

**Trigger:** the borrower taps Check on the property check, or the underwriter opens a loan file.

## Main flow

1. The user asks for an estimate (the property check flow of AL-6).
2. al-ai values the home and works out the breakdown: a **baseline** (the model's average estimate over the 100 sample homes) and one euro **contribution** for each of the six inputs: county, floor area, bedrooms, property type, BER and the Eircode area.
3. al-ai returns the estimate with `baseline_eur` and `contributions` (`feature`, `value`, `eur` for each input).
4. The app shows "How each detail moved the estimate" under the result: the starting point first, then one row per detail with a signed euro amount, biggest first, ending at the estimate.
5. The rows add up to the estimate shown on screen.

## Alternative flows

- **A. Rounding.** Each row is shown to the nearest €1,000. When plain rounding would not add up to the estimate shown, the app moves the rows closest to the rounding line by €1,000 so the list adds up. (In the 6 Nov test, plain rounding gave €275,000 against a €273,000 estimate, so floor area showed −€90,000 instead of −€89,000 and BER +€13,000 instead of +€14,000.)
- **B. Unfamiliar Eircode area.** The model values the home as if the area were Other, and the low-support warning shows next to the breakdown. The breakdown still shows, with an "Eircode area" row.
- **C. Underwriter (AL-133, In Review).** The loan file shows the same breakdown as a chart, with the low-support warnings next to it, from the valuation stored for that application.

## Exceptions

- **No breakdown.** If the estimate works but its breakdown cannot be worked out, al-ai returns both fields as null with the warning "The breakdown of this estimate isn't available right now." The app hides the section and the rest of the result still works.
- **Pieces don't add up.** If the baseline plus the contributions don't match the estimate, the app hides the section rather than show numbers that disagree.
- The property check's own exceptions (invalid fields, service down, signed out) apply as in AL-6.

## Postconditions

- **Success:** the user sees the estimate and how each detail moved it. Nothing extra is saved.
- **Failure:** the user still sees the estimate, without the breakdown.

## Business rules

- The contributions are exact Shapley values over the six inputs (64 combinations), not an approximation. Baseline plus contributions equals the estimate within a cent (AL-131 checks within €1).
- The baseline is a starting point, not a price for any real house. It is about €577,000 because a few large, expensive homes are in the sample; the middle sample home is about €396,000.
- The breakdown explains this estimate only. It does not say what changing the house would do.
- On screen the baseline is labelled "Starting point: average of the model's sample homes", never a typical or expected price (AL-132, decided 27 Oct).
- County and Eircode area carry related information, so they share credit: a Dublin home can show a plus for the county and a minus for the Eircode area. Read them together.
- The list is biggest first, ignoring the sign.
- The breakdown adds about 0.2 seconds to a valuation call (median 196 ms, limit 500 ms).
- The numbers are worked out in al-ai, never in the app, so the app and the portal show the same breakdown for the same home.

## Flow diagram

The affordability check and the valuation: `docs/diagrams/02-flow-affordability-valuation.png`. The breakdown is part of the valuation response in that flow.

## Stories in this epic

| Story | What | Owner | Sprint | Status |
|---|---|---|---|---|
| [AL-131](https://alprojectcs3.atlassian.net/browse/AL-131) | The valuation endpoint returns how much each house feature added to or took off the estimate | Nic | Sprint 2 | Done on 6 Nov |
| [AL-132](https://alprojectcs3.atlassian.net/browse/AL-132) | The borrower sees how each detail of the house moved its estimated price | Ibrahima | Sprint 2 | Done on 6 Nov |
| [AL-133](https://alprojectcs3.atlassian.net/browse/AL-133) | The underwriter sees the valuation breakdown in the loan file | Nikoloz | Sprint 2 | In Review on 10 Nov (chart merged, #140) |

## Notes

- The epic and AL-133 still say the chart is labelled "compared with a typical listing". The app changed that wording on 27 Oct (AL-132) because the baseline is not a typical price; the portal's chart (#140) uses the app's wording, "Starting point".
- The epic is done when the app and the portal show the same breakdown for the same property on the seeded data. That needs AL-133.
- How to read the numbers: `al-ai/models/valuation/MODEL_CARD.md`, "How to read the breakdown".
- Test case for the borrower's screen: `AL-132/test-case.pdf` in this folder. On 6 Nov the app's rows matched `POST /ai/valuation` for the same home within €1,000, with the rounding in alternative flow A.
