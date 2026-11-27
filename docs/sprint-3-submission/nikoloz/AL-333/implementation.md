# AL-333: As an underwriter, I read a loan file whose committee and loan note are shown as clear 3D views of the stored data

## What was built

The loan file has a 3D committee council and chain inside the Loan note card. Pillars use stored votes; Macro observes. Only this loan's two chain records are highlighted, with stored hashes and valid Amoy links. Text tabs and note details retain the facts without WebGL. Review fix 40813ee preserves the declined outcome in a Closed timeline.

## Pull requests: web portal

| PR | Title | Merged / state | By |
|---|---|---|---|
| [#280](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/280) | AL-333 Restyle the loan file with the 3D committee and blockchain stages | 2026-11-23 (3efeea3) | Nikoloz |

## Main files changed

- al-web/src/pages/shared/LoanFilePage.tsx
- al-web/src/components/lending/CommitteeStage.tsx
- al-web/src/components/lending/ChainStage.tsx
- al-web/src/components/lending/council/councilScene.ts
- al-web/src/components/lending/council/chainScene.ts
- al-web/src/components/lending/StatusTimeline.tsx
- al-web/src/styles.css

## How it was tested

Recorded commands were run in al-web, not during document preparation. PR #280: npx tsc -b clean; npm test 780 passed in 34 files; npm run build passed; betterleaks clean. Facts record 792 tests after review and approvals by Ibrahima and Nic; later command output is not supplied.

See test-case.md for individual browser, sample-preview, automated and Not run results.

## Limits and known issues

Merged 23 Nov at 23:55, 3efeea3. The 23 Nov team decision supersedes the old broker-access wording in the PR body. Current main also permits read-only admins. Parent Epic is not supplied.

A real phone and non-Chromium browsers were not checked. Localhost hosted-data API calls encountered expected CORS refusal. The scene represents stored records, not a new transaction.

## Evidence

sprint3-facts.md (26 Nov 2026), linked PR bodies and origin/main at ebcfa88. Test counts are historical evidence, not new submission-preparation runs.
