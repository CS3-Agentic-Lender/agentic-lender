# AL-347: As an underwriter or broker, I land on an Overview that shows my work queue and key figures

## What was built

Both Overview pages replace placeholders. Underwriters see queue figures, weekly approvals, indicative LTV, oldest waiting decisions and status activity. Brokers see active/AI/approved/unread figures, attention items and status changes. Queries carry brokerId. Review 443474d refreshes time per snapshot and waits for listeners.

## Pull requests: web portal

| PR | Title | Merged / state | By |
|---|---|---|---|
| [#285](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/285) | AL-347 Add the underwriter and broker overview pages | 2026-11-26 (a36c7d2) | Nikoloz |

## Main files changed

- al-web/src/pages/underwriter/UnderwriterOverview.tsx
- al-web/src/pages/broker/BrokerOverview.tsx
- al-web/src/pages/shared/overviewFigures.ts
- al-web/src/context/OverviewContext.tsx
- al-web/src/services/overviewService.ts
- al-web/src/hooks/useThreads.ts

## How it was tested

Recorded commands were run in al-web, not during document preparation. PR #285: npm test 1053 passed in 56 files at PR open; tsc -b, npm run build and betterleaks clean. No post-review count supplied.

See test-case.md for individual browser, sample-preview, automated and Not run results.

## Limits and known issues

Merged 26 Nov, a36c7d2. Missing seed statusHistory leaves weekly approval/activity empty. Parent Epic not supplied.

## Evidence

sprint3-facts.md (26 Nov 2026), linked PR bodies and origin/main at ebcfa88. Test counts are historical evidence, not new submission-preparation runs.
