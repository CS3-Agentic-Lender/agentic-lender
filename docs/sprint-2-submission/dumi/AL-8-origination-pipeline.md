# Use case: AL-8 Origination Pipeline (Sprint 2 update)

**Epic.** An underwriter sees every application in one live queue, grouped by LTV, risk tier and lifecycle status, with a full loan file behind each. This update covers the backend side of that epic, which is mine. The queue and the loan file screens are Nikoloz's, and his Sprint 1 use case for the epic still applies.

## What changed in Sprint 2

- **The status lifecycle is now enforced (AL-34, AL-169).** An application moves through Draft, Applied, AI Deliberated, Underwriter Approved or Declined, Funded and Closed, and only by the moves in one table in al-core. Every move records who made it and when.
- **Closing is built (AL-293).** The underwriter can close a Funded or Declined application. Closing a Funded one also closes its loan note on the chain.
- **The AI committee moves the status by itself (AL-141, Nic).** When a run completes the application moves to AI Deliberated. A failed run leaves it at Applied.
- **The queue's data is richer.** The application endpoint returns `ltv_band` and `risk_tier` (AL-252), the DTI breakdown fields are stored (AL-65), and brokers can no longer read Drafts (AL-263).
- **Still open:** the loan file with the DTI breakdown (AL-33, Nikoloz) is To Do.

## Overview

| Item | Detail |
|---|---|
| Epic | AL-8 Origination Pipeline |
| Feature (from the brief) | Web: Origination Pipeline View (grouped by LTV thresholds, risk tiers and lifecycle status); Loan File & Collateral Assessment View (complete DTI breakdown). |
| Owner | Nikoloz (the portal: queue and loan file). Solomon owns the backend: status, LTV and risk-tier fields, the Firestore indexes for the queue, and the status lifecycle. |
| Sprint | Sprint 1 (8 to 25 Oct 2026) built the queue. Sprint 2 (27 Oct to 15 Nov 2026) built the status lifecycle; the loan file is still to do. |
| Diagram | The status moves: `AL-34/wireframe.png` in this folder (from `docs/diagrams/08-status-transitions.png`). |

## Goal

As an underwriter, I want every application in one queue grouped by LTV, risk tier and status, with a full loan file behind each, so that I can prioritise and review files quickly.

## Actors

- **Underwriter:** signed in to the web portal with the underwriter role.
- **Borrower:** their submitted application is what appears in the queue (iOS app).
- **Broker:** sees their own clients' applications, but no Drafts.
- **al-core:** stores applications and their status, LTV band and risk tier, and decides which status moves are allowed.
- **al-ai:** the committee writes the risk tier and recommendation, and its run moves the application to AI Deliberated.

## The status lifecycle (what Sprint 2 added)

| From | To | Who |
|---|---|---|
| Draft | Applied | the borrower, on submit |
| Applied | AI Deliberated | the AI committee, when a run completes |
| AI Deliberated | Underwriter Approved or Declined | the underwriter |
| Underwriter Approved | Funded | the mint step |
| Funded or Declined | Closed | the underwriter |

Any other move is refused with a 409 and nothing changes. Each move adds an entry to `statusHistory` with from, to, who and when.

## Business rules

- Status strings are exact: Draft, Applied, AI Deliberated, Underwriter Approved, Declined, Funded, Closed. The AI run state, the risk tier (A to D) and the AI recommendation are separate fields, never extra statuses.
- A failed AI run doesn't change the status. The reason is kept on the run record.
- All writes go through the API. The Firestore rules allow no client writes, so a modified app can't write a wrong status.

## Stories in this epic

| Story | What | Owner | Sprint | Status on 8 Nov |
|---|---|---|---|---|
| AL-32 | An underwriter sees all applications in a queue grouped by LTV, risk tier and status | Nikoloz | Sprint 1 | Done |
| AL-33 | An underwriter opens a loan file with the borrower's full DTI breakdown | Nikoloz | Sprint 2 | To Do |
| AL-34 | An application moves through Applied, AI Deliberated, Approved, Funded, Closed | Solomon | Sprint 2 | Done |

## What Sprint 2 delivered (Solomon)

- The status table and the history entry for every move (AL-169, PR #129).
- The sign-off, mint and close endpoints that make the moves after Applied (AL-166, AL-66, AL-293).
- `ltv_band` and `risk_tier` on the application endpoint (AL-252) and the DTI breakdown fields (AL-65).
- Drafts hidden from brokers (AL-263).
