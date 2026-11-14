# Use case: AL-194 Home equity line of credit (HELOC)

**Epic.** A homeowner borrows against the value of a home they already own.

## What changed in Sprint 2

- **The borrower side is built (AL-195, Done).** The HELOC check (AL-207, #112) and the HELOC application with submit (AL-208, #143) are merged, on top of the Sprint 1 choice (AL-206, #62).
- **The HELOC fields are in al-core (AL-197, Dumi, Done).** A HELOC is saved with `loanType: heloc` and needs no asking price (#120).
- **After submitting,** once the AI committee has run, the status screen shows the HELOC's combined LTV against the 80% limit, with DTI and approval likelihood (AL-31, In Progress). The backend that writes these figures merged on 9 Nov (#185): on submit a HELOC's likelihood is Unknown, and the combined LTV and a likelihood label are written when the committee run completes. On 6 Nov I saw the figures on a seeded HELOC, not yet on a freshly submitted one. (Main flow step 9.)
- **Checked end to end on 6 Nov:** the reference home gave a €59,883 line, matching the endpoint, and a submitted HELOC was saved with `loanType: heloc` and status Applied.
- **Still to come:** the underwriter's HELOC review in the portal (AL-196, Nikoloz, In Progress on 10 Nov: the first part of its subtask AL-213 is merged, #141, showing the loan type in the queue and the HELOC collateral in the loan file, and the rest is in review).

## Overview

| Item | Detail |
|---|---|
| Epic | AL-194 Home equity line of credit (HELOC) |
| Feature (from the brief) | The platform covers "mortgage or HELOC", and the loan note represents "mortgages/HELOCs". |
| Owner | Ibrahima Toure (iOS, AL-195). The underwriter review is Nikoloz's (AL-196); the HELOC calculations are Nic's (AL-198) and the HELOC fields Dumi's (AL-197). |
| Sprint | Sprint 1 (8 to 25 Oct 2026) built the wireframes and the mortgage-or-HELOC choice. Sprint 2 (27 Oct to 15 Nov 2026) built the check and the application; the underwriter review is in progress. |
| Wireframes | Figma "AL-80 Borrower app", section HELOC (AL-205): https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=393-1604. Also `AL-195/wireframe.png` in this folder. |

## Goal

As a homeowner, I want to apply for a credit line against the value of my home, so that I can borrow against the equity I've built up.

## Actors

- **Homeowner (borrower):** signed in to the iOS app, with a broker chosen.
- **al-ai:** estimates the home's value with the valuation model and works out the maximum line.
- **al-core:** saves and submits the HELOC application with `loanType: heloc`.
- **Underwriter:** reviews the HELOC in the portal with its combined LTV and collateral value (AL-196).
- **AI credit committee:** the same four agents as for a mortgage, with HELOC rules.

## Preconditions

- The borrower is signed in, has a borrower profile and a broker, and owns the home.
- al-ai has the valuation model and the HELOC affordability endpoint; al-core has the HELOC fields.

**Trigger:** the borrower taps "What can I borrow?" on Home and chooses Borrow against my home.

## Main flow

1. The borrower chooses Borrow against my home (HELOC).
2. They enter the five house details (county, size, bedrooms, property type, BER), the balance left on their mortgage, gross income, monthly debts and a repayment term. No deposit and no asking price.
3. The app sends them to al-ai, which estimates the home's value and works out the maximum line.
4. The app shows the maximum credit line, what limited it, the repayment if the line is fully drawn and at +2 points, and the estimated value, labelled indicative.
5. The borrower taps Start application. The HELOC application opens filled in, with no deposit field.
6. They add the credit line they want, take-home pay, living costs, employment and years in the job, and save it as a Draft.
7. They review and submit. al-core saves it with `loanType: heloc` and status Applied, and the app shows a reference.
8. The AI committee and the underwriter review it like a mortgage, with the HELOC rules below.
9. The borrower follows it on the status screen like a mortgage (AL-5), where the first figure is the combined LTV against the 80% limit. The figure appears once the AI committee run has completed, because the backend writes it then (AL-31, In Progress).

## Alternative flows

- **A. No equity.** At step 4, if the balance is 80% or more of the estimated value, the line is €0 and the app says there is no equity to borrow against yet. There is no Start application button.
- **B. Mortgage instead.** At step 1 the borrower picks Buy a home; the mortgage flow (AL-5) is unchanged.
- **C. A draft of the other type.** If the borrower has a mortgage draft and starts a HELOC (or the other way round), the form doesn't fill from it and says why. A submitted application of the other type blocks a new one.

## Exceptions

- Invalid inputs, such as an empty mortgage balance: an error under the field ("Enter what's left on your mortgage, or 0 if it's paid off") and nothing is sent.
- No connection, a server error or an expired sign-in: the same handling as the mortgage check.
- The borrower already has an application in progress: al-core refuses a new one.

## Postconditions

- **Success:** one application with `loanType: heloc` and status Applied.
- A mortgage application behaves exactly as before.

## Business rules

- Combined LTV is (existing balance + requested line) / estimated value, capped at 80%. The brief gives no number, so 80% is our prototype assumption.
- The maximum line is 80% of the estimated value minus the mortgage balance. Never below zero, and no income multiple. Equity is the only limit, so the result always reads "Limited by equity". Income and monthly debts are asked for on the form but do not reduce the line: debts are judged by the credit committee.
- The stress test assumes the line is fully drawn and repaid over the term at the benchmark rate plus 2 points.
- The valuation model's estimate is the collateral value. It is indicative (trained on 2024 asking prices), so the screens say "estimated value", never "asking price", and a surveyor valuation condition is always added.
- The HELOC check takes no Eircode, so its estimate can differ from a property check of the same house that includes one (€262,354 against €273,000 for the reference home on 6 Nov).
- The choice of mortgage or HELOC is made once, at the start of the check, and carried into the application.

## Flow diagrams

The check uses the same call as the mortgage check: `docs/diagrams/02-flow-affordability-valuation.png`.

## Stories in this epic

| Story | What | Owner | Sprint | Status on 6 Nov |
|---|---|---|---|---|
| AL-195 | As a homeowner, I apply for a HELOC against my property's value | Ibrahima | Sprint 1 to 2 | Done: choice (#62), check (#112), application (#143); euro amount fixes #158 and #166 |
| AL-196 | As an underwriter, I review a HELOC application with its combined LTV and collateral value | Nikoloz | Sprint 2 | In Progress on 10 Nov (subtask AL-213: #141 merged, a second PR in review) |

## Notes

- Scope decision recorded in `docs/infrastructure.md` and agreed with Seamus: a lighter HELOC flow on the same pipeline as mortgages.
- Backend subtasks: AL-197 HELOC fields (Dumi, Done, #120) and AL-198 HELOC calculations (Nic, Done, #95).
- Test case: `AL-195/test-case.pdf` in this folder (Sprint 2).
