# AL-349: As an underwriter, I read a tighter loan file with no empty boxes and the affordability figures shown

## What was built

Empty valuation content becomes a line and empty concerns/conditions one sentence. Run details holds metadata/copy IDs. Affordability shows repayment, DTI, stressed DTI, surplus and breaches from stored fields; missing values say Not stored. Logo links to role Overview. Review d65bb1d fixes stale failed-run figures, one DTI source, loading layout and surplus bar.

## Pull requests: web portal

| PR | Title | Merged / state | By |
|---|---|---|---|
| [#287](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/287) | AL-349 Tighten the loan file and show the affordability figures | 2026-11-26 (9a9a18f) | Nikoloz |

## Main files changed

- al-web/src/components/lending/AffordabilityFigures.tsx
- al-web/src/components/lending/AgentVote.tsx
- al-web/src/components/lending/CommitteeConsole.tsx
- al-web/src/components/lending/ValuationBreakdown.tsx
- al-web/src/pages/shared/LoanFilePage.tsx
- al-web/src/components/PortalHeader.tsx
- al-web/src/services/loanFileService.ts

## How it was tested

Recorded commands were run in al-web, not during document preparation. PR #287: npm test 1042 passed in 53 files on rebased branch. One initial timeout passed alone. tsc -b, npm run build and betterleaks clean. No later full-suite count supplied for d65bb1d.

See test-case.md for individual browser, sample-preview, automated and Not run results.

## Limits and known issues

Merged 26 Nov, 9a9a18f. Figures come from review and run policy gate, not calculations stored in the run; the screen explains this. Parent Epic not supplied.

The run does not store its calculations. Affordability reads the review dtiBreakdown, application DTI and run policy breaches; this limit is explained on screen.

## Evidence

sprint3-facts.md (26 Nov 2026), linked PR bodies and origin/main at ebcfa88. Test counts are historical evidence, not new submission-preparation runs.
