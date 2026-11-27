# Use case: AL-10 Stress-Testing Simulator

**Epic.** An underwriter changes an interest rate or house-price assumption and reads how the portfolio changes. Figures come from al-ai.

## What changed in Sprint 3

- Rate shock delivered in [PR #266](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/266), merged 24 Nov; redesigned in [PR #286](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/286), merged 26 Nov.
- House-price fall is built in [PR #289](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/289), open, in review.
- The live rate-shock URL correction, [PR #288](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/288), is open, in review.

## Overview

| Item | Detail |
|---|---|
| Epic | AL-10 Stress-Testing Simulator |
| Owner | Nikoloz (portal); backend work by Dumi/Nic |
| Sprint | Sprint 3 |
| Wireframes | AL-40/wireframe.png, AL-41/wireframe.png, AL-348/wireframe.png |

## Goal

As an underwriter, I want to change the portfolio's rate or house-price assumptions, so that I can identify applications exposed to reduced affordability or increased LTV.

## Actors

- Underwriter: selects a shock and reads results.
- Portal: sends the request and displays returned figures.
- al-ai: calculates the portfolio response.

## Preconditions

- The underwriter is signed in and the portfolio endpoints are reachable.
- For house prices, the open portal branch is needed until PR #289 merges.
- Hosted calculations need the pending URL correction.

**Trigger:** the underwriter opens the stress page.

## Main flow

1. Open rate shock. The page starts at +200 bps.
2. Select +100 to +300 bps, or use a preset, then recalculate.
3. The portal calls POST /ai/portfolio/rate-shock.
4. Read after-rise DTI towers against 40%/50% rings, tiles and Every application.
5. Follow a loan-file link to examine an application.

## Alternative flows

- House prices, pending merge: open /underwriter/stress/house-prices, choose a fall from 0-40% in steps of 5 and call POST /ai/portfolio/downturn.
- Read LTV towers against 80%/90%, before/after counts and exposure above 90%.
- Open Loans crossing 90% or Every application, then follow a loan-file link.
- Without WebGL, use controls and tables.

## Exceptions

- Loading, calculation error, empty portfolio and forbidden access have separate states.
- Old replies do not overwrite a newer selection.
- Skipped applications are listed with their reasons.
- The deployed rate shock currently calls localhost; PR #288 fixes the base URL. A successful hosted calculation has not been recorded.

## Postconditions

The underwriter has read the returned scenario figures. This is an indicative simulation, not a verified property valuation.

## Business rules

- The portal displays returned figures rather than recalculating them.
- Rate-shock controls use +100 to +300 bps.
- House-price controls use 0-40% in steps of 5; reset to -10%.
- Threshold counts are strictly above 80%/90%, not equal.
- Every numeric result remains available as text.

## Stories in this epic

| Story | Delivery |
|---|---|
| AL-40 | Rate-shock page; portal subtask AL-162, backend AL-68 |
| AL-41 | House-price fall; portal subtask AL-163 open, backend AL-69 Done |

AL-348 is the merged rate-shock redesign; its parent Epic is not supplied in the facts.

## Not built yet, and known limits

House-price portal and live URL correction are open, in review. House-price browser evidence is a sample preview. The original rate shock has a real local API check, with manually cached ECB data after a timeout. Neither proves the hosted scenario works.

## Notes

Evidence: sprint3-facts.md and the linked PR bodies. Story test cases distinguish real API runs, sample previews and Not run checks.
