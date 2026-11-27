# AL-41: As an underwriter, I simulate a house price downturn and see the change in portfolio LTVs

## What was built

Open PR #289 adds /underwriter/stress/house-prices, 0-40% fall controls in steps of 5, presets, LTV towers with 80%/90% rings, threshold tiles, crossing-loan links and Every application. It calls POST /ai/portfolio/downturn. It is not merged.

## Pull requests: web portal

| PR | Title | Merged / state | By |
|---|---|---|---|
| [#289](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/289) | AL-163 Add the house price fall page with a 3D stage | open, in review | Nikoloz |
| [#288](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/288) | Send the live rate shock to the API gateway instead of localhost | open, in review | Nikoloz |

## Main files changed

- al-web/src/pages/underwriter/HousePriceFallPage.tsx (open PR #289)
- al-web/src/components/stress/HousePriceStage.tsx (open PR #289)
- al-web/src/components/stress/housePriceScene.ts (open PR #289)
- al-web/src/components/stress/DownturnResultsTable.tsx (open PR #289)
- al-web/src/services/stressService.ts (open PR #289)
- al-web/src/routes.tsx (open PR #289)
- Open #288: .github/workflows/portal.yml and al-web/src/services/stressService.ts (deployment URL correction).

## How it was tested

Recorded commands were run in al-web, not during document preparation. PR #289: 61 new tests; npm test 1159-1161 passed per run. One to three files timed out under load and passed alone. tsc -b, npm run build and betterleaks clean. These are open-branch results.

See test-case.md for individual browser, sample-preview, automated and Not run results.

## Limits and known issues

No merged portal delivery yet. Backend Done is not a test of this page. LTV is indicative and model based, not a verified valuation.

## Evidence

sprint3-facts.md (26 Nov 2026), linked PR bodies and origin/main at ebcfa88. Test counts are historical evidence, not new submission-preparation runs.
