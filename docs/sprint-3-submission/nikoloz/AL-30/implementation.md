# AL-30: As an underwriter, I read each agent's reasoning trail and the committee's consensus

## What was built

The loan file reads stored votes, reports, model details, calls, Macro sources, memo headings and policy gate. The 3D council selects the matching text tab. Brokers keep outcome and conditions under the 23 Nov team decision. Failed-run Re-run is built in open PR #290.

## Pull requests: web portal

| PR | Title | Merged / state | By |
|---|---|---|---|
| [#207](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/207) | AL-156 Render the stored credit memo under its headings | 2026-11-15 (3417f5c) | Nikoloz |
| [#280](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/280) | AL-333 Restyle the loan file with the 3D committee and blockchain stages | 2026-11-23 (3efeea3) | Nikoloz |
| [#290](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/290) | AL-30 Let an underwriter re-run a failed committee run | open, in review | Nikoloz |
| [#195](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/195) | Committee deliberation console | 2026-11-12 (origin/main history) | Nikoloz |

## Main files changed

- al-web/src/components/lending/CommitteeConsole.tsx
- al-web/src/components/lending/CreditMemo.tsx
- al-web/src/components/lending/CommitteeStage.tsx
- al-web/src/services/committeeService.ts
- Open #290: al-web/src/services/committeeRunService.ts and context/CommitteeContext.tsx.

## How it was tested

Recorded commands were run in al-web, not during document preparation. PR #290: 74 focused tests passed; full suite 1127/1133 in both runs. tsc -b, build and betterleaks clean. PR #207: 717 in recorded branch run, 14 fresh focused; production build passed with bundle-size warning. PR #280: 780 recorded tests; facts record 792 after review.

See test-case.md for individual browser, sample-preview, automated and Not run results.

## Limits and known issues

Real-run memo/source/failure checks need a re-test. PR #290 remains open, in review; no completed browser re-run. Six full-suite failures include a sign-out alert test also failing on untouched main.

## Evidence

sprint3-facts.md (26 Nov 2026), linked PR bodies and origin/main at ebcfa88. Test counts are historical evidence, not new submission-preparation runs.
