# Use case: AL-5 Loan Application

**Epic.** A borrower sees what they can borrow, applies for a mortgage and follows the application.

## What changed in Sprint 2

- **Following the application is built (AL-21, Done).** After submitting, the borrower follows the status live: a vertical timeline with dates, an application card on Home, an "Offline" banner when the phone loses its connection, and the decline reason when there is one. (Main flow step 12, alternative flows E and F.)
- **The home can come from a saved property check (AL-22).** At step 7 the borrower can pick a saved check to fill the home's details, or open Check a property from the form and come back to it. (Alternative flow G.)
- **LTV, DTI and approval likelihood** show on the status screen after submitting (AL-31, In Progress). The backend writes them on submit since 9 Nov (#185).
- **The rate:** the ECB rate tool is merged (AL-124, 6 Nov) but the affordability endpoint still uses a stand-in benchmark of 4.0% (Aug 2026) until it is wired in.
- **The AI committee starts by itself** on submit since 7 Nov (AL-141, #176).

## Overview

| Item | Detail |
|---|---|
| Epic | AL-5 Loan Application |
| Feature (from the brief) | Mobile: Affordability & Loan Application (household gross income, existing debts, deposit, requested term); AL-AI Interface & Status (current lifecycle state). Core: real-time application states. |
| Owner | Ibrahima Toure (iOS borrower app). The affordability endpoint is Nic's (al-ai) and the application endpoints are Dumi's (al-core). |
| Sprint | Sprint 1 (8 to 25 Oct 2026) built the affordability check and the application. Sprint 2 (27 Oct to 15 Nov 2026) built following the application's status (AL-21). |
| Wireframes | Figma "AL-80 Borrower app", sections AL-107 (affordability) and AL-109 (application and status): https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1. The status frames are in `AL-21/wireframe.png` in this folder. |

## Goal

As a borrower, I want to see what I can borrow, apply, and follow my application, so that I know where I stand at every step.

## Actors

- **Borrower:** signed in to the iOS app, with a broker chosen.
- **al-ai** (the AI API): works out what the borrower can borrow, using the benchmark rate for Irish new mortgages.
- **al-core** (the core API): saves, edits and submits applications in Firestore, and checks who may change them.
- **Broker:** the broker the borrower chose; sees the borrower's application in the portal.
- **AI credit committee:** reviews the application after it is submitted and moves it to AI Deliberated.

## Preconditions

- The borrower is signed in (Firebase Auth) and has a borrower profile and a broker.
- al-ai and al-core are running behind the gateway; every request carries the borrower's Firebase ID token.

**Trigger:** the borrower taps "What can I borrow?" on Home.

## Main flow

1. The borrower chooses Buy a home (mortgage).
2. They enter single or joint, gross yearly income (one per applicant), monthly debts, deposit, a term of 5 to 35 years and whether they are a first-time buyer. Calculate stays off until the form is valid.
3. The app sends the answers to al-ai (`POST /ai/affordability`). A joint application's incomes are sent as one household total.
4. al-ai returns the maximum loan, maximum price, monthly repayment, repayment if rates rise 2 points, which limit applied and the rate with its month.
5. The app shows the result, labelled indicative, not an offer.
6. The borrower taps Start application. The form opens filled in from the check.
7. They add the loan amount, take-home pay, living costs, employment, years in the job and the home (address, Eircode, county, asking price, type, size, bedrooms, BER), and tap Save draft.
8. al-core saves it with status Draft (`POST /core/applications`) and the app keeps its id on the phone.
9. The borrower taps Review. Check your application shows every field with an Edit link.
10. The borrower taps Submit and confirms. al-core checks the required fields and sets the status to Applied (`POST /core/applications/{id}/submit`).
11. The app shows "Application submitted" and a short reference.
12. The borrower follows the application (AL-21): the Home card shows its status and the next step, and View status opens the timeline (Draft, Applied, AI Deliberated, Underwriter Approved or Declined, Funded, Closed) with the date each finished step was reached. A status change in Firestore shows within 5 seconds, with no refresh.

## Alternative flows

- **A. Joint application.** At step 2 the borrower picks Joint and enters both incomes.
- **B. Loan above the maximum.** At step 7 a loan above the calculated maximum shows a warning; the borrower can still continue.
- **C. Come back later.** The borrower leaves after step 8. Later, the form reopens with the saved draft (`GET /core/applications/{id}`), and changes save to the same draft (PATCH).
- **D. Cancel the confirmation.** At step 10 the borrower cancels; the application stays a Draft.
- **E. Offline while following.** At step 12, if the phone loses its connection, the last known status stays on screen with an "Offline" banner, which goes once the connection is back and the server answers.
- **F. Declined.** At step 12 a declined application shows the reason under the decision when the underwriter gave one.
- **G. Home from a saved property check.** At step 7 the borrower taps Use a saved property and picks one, which fills the Eircode, county, asking price, type, size and bedrooms. Or they open Check a property from the form, and the form is still there when they come back.

## Exceptions

- Invalid inputs (an empty amount, a negative amount, more than €10,000,000, a term outside 5 to 35 years, a bad Eircode): an error under the field and nothing is sent.
- No connection, or a server error: "Couldn't calculate" or a save error with Try again. A second tap while a request is running is ignored.
- Signed out or token expired: the borrower is asked to sign in again.
- The borrower already has an application in progress: al-core refuses a new one (409) and the app says so.
- Editing after submitting: the application opens read-only, and al-core refuses a change (409).
- A required field is missing on submit: al-core names it, and the app says what to add.
- The status can't be read (step 12): the screen says so and Retry listens again.

## Postconditions

- **Success:** one application exists for the borrower with status Applied and a `submittedAt` time, its broker can see it, and the borrower can follow it live.
- **Stopped early:** the application stays a Draft and can be changed later. A check on its own stores nothing.

## Business rules

- Maximum loan is the lowest of: 4× income for first-time buyers or 3.5× otherwise, 90% loan-to-value, and the loan where the repayment at the rate plus 2 points plus existing debts reaches 40% of gross monthly income. The first two are the Central Bank of Ireland's mortgage measures; the 40% cap is our prototype policy.
- The calculation runs in al-ai, never in the app, so the app and the underwriter portal agree.
- The rate is the benchmark for Irish new mortgages, shown with its month and labelled indicative. On 6 Nov it is a stand-in 4.0% (Aug 2026) set in al-ai's settings; the ECB rate tool (AL-124) is merged and will replace it.
- One active application per borrower. Editable while Draft, read-only from Applied, because the AI review starts on submit.
- The app writes through al-core's API, never straight to Firestore. It reads the application's status straight from Firestore, live.
- Home shows the borrower's newest application (the most recently created).
- Lifecycle states: Draft, Applied, AI Deliberated, Underwriter Approved or Declined, Funded, Closed. Status names and badge colours are the same in the app and the portal.
- Out of scope: document uploads such as payslips.

## Flow diagrams

- The affordability check: `docs/diagrams/02-flow-affordability-valuation.png`.
- Submitting, and the AI review that follows: `docs/diagrams/03-flow-submit-ai-review.png`.
- The lifecycle states: `docs/diagrams/08-status-transitions.png`.

## Stories in this epic

| Story | What | Owner | Sprint | Status on 6 Nov |
|---|---|---|---|---|
| AL-19 | See how much I can borrow from my income, debts and deposit | Ibrahima | Sprint 1 | Done |
| AL-20 | Submit a loan application with my requested term and target property | Ibrahima | Sprint 1 | Done |
| AL-21 | See the current status of my application | Ibrahima | Sprint 2 | Done: timeline (#131), live updates and offline banner (#142), Home card (#144); fixes #136 and #157 |

## Notes

- Backend subtasks: AL-57 affordability endpoint (Nic); AL-58, AL-244, AL-245 and AL-251 application endpoints (Dumi); AL-59 live status for clients (Dumi, Sprint 2). All Done.
- Test cases: `AL-21/test-case.pdf` in this folder (Sprint 2). AL-19 and AL-20's are in the Sprint 1 submission.
