# AL-348: As an underwriter, I run the rate shock on a redesigned page with a 3D view of the portfolio

## What was built

A light page surrounds one dark 3D stage with docked controls. Towers use after-rise DTI and grow from before values; rings mark 40%/50%. Tiles and Every application retain the numbers. Tower clicks mark rows. Review 712a559 retains true capped DTI and control focus. Separate DTI/surplus charts were dropped by the owner.

## Pull requests: web portal

| PR | Title | Merged / state | By |
|---|---|---|---|
| [#286](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/286) | AL-348 Restyle the rate shock with a 3D view of the portfolio | 2026-11-26 (ebcfa88) | Nikoloz |
| [#288](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/288) | Send the live rate shock to the API gateway instead of localhost | open, in review | Nikoloz |

## Main files changed

- al-web/src/pages/underwriter/RateShockPage.tsx
- al-web/src/components/stress/RateShockStage.tsx
- al-web/src/components/stress/rateShockScene.ts
- al-web/src/components/stress/rateShockFigures.ts
- al-web/src/components/stress/ShockResultsTable.tsx
- al-web/src/styles.css
- Open #288: .github/workflows/portal.yml and al-web/src/services/stressService.ts (deployment URL correction).

## How it was tested

Recorded commands were run in al-web, not during document preparation. PR #286: npm test 1048 passed, then 1054 after 712a559 (facts). Unrelated admin timeouts pass alone. tsc -b, npm run build and betterleaks clean; three.js remains lazy.

See test-case.md for individual browser, sample-preview, automated and Not run results.

## Limits and known issues

Merged 26 Nov, ebcfa88. Presentation uses the existing response. Parent Epic not supplied.

The live page called localhost:5001. PR #288 is open, in review; successful authenticated hosted re-test Not run.

## Evidence

sprint3-facts.md (26 Nov 2026), linked PR bodies and origin/main at ebcfa88. Test counts are historical evidence, not new submission-preparation runs.
