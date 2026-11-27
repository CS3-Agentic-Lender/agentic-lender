# AL-40: As an underwriter, I apply a +100 to +300 bps rate shock and see how the portfolio holds up

## What was built

The underwriter chooses a +100 to +300 bps rise and calls POST /ai/portfolio/rate-shock. The original band chart was replaced by a light page with dark 3D stage, docked controls, DTI towers, threshold rings, tiles and Every application table. The portal displays returned figures.

## Pull requests: web portal

| PR | Title | Merged / state | By |
|---|---|---|---|
| [#266](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/266) | AL-162 Add the rate shock page with the affordability band chart | 2026-11-24 (8ff3e12) | Nikoloz |
| [#286](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/286) | AL-348 Restyle the rate shock with a 3D view of the portfolio | 2026-11-26 (ebcfa88) | Nikoloz |
| [#288](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/288) | Send the live rate shock to the API gateway instead of localhost | open, in review | Nikoloz |

## Main files changed

- al-web/src/pages/underwriter/RateShockPage.tsx
- al-web/src/context/StressContext.tsx
- al-web/src/components/stress/RateShockStage.tsx
- al-web/src/components/stress/ShockResultsTable.tsx
- al-web/src/services/stressService.ts
- Open #288: .github/workflows/portal.yml and al-web/src/services/stressService.ts (deployment URL correction).

## How it was tested

Recorded commands were run in al-web, not during document preparation. PR #266: 33 new tests; npm test recorded 756/756, then 769/769 after merging main; npm run build passed. PR #286: 1048 passed, then 1054 after review commit 712a559 (facts). tsc -b, npm run build and betterleaks clean in PR evidence.

See test-case.md for individual browser, sample-preview, automated and Not run results.

## Limits and known issues

The original local run needed a manually cached ECB mortgage rate of 3.9% after a timeout. The redesign replaced the band chart; separate DTI and surplus charts were dropped by the owner. Re-test the hosted service after PR #288 lands.

The live page called localhost:5001. PR #288 is open, in review; successful authenticated hosted re-test Not run.

## Evidence

sprint3-facts.md (26 Nov 2026), linked PR bodies and origin/main at ebcfa88. Test counts are historical evidence, not new submission-preparation runs.
