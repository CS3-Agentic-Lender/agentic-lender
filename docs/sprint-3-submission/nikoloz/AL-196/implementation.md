# AL-196: As an underwriter, I review a HELOC application with its combined LTV and collateral value

## What was built

The queue has loan types and a HELOC filter. Collateral shows value, balance, requested limit, combined LTV, 80% cap and surveyor/exception conditions, without asking-price comparison. DTI, committee, sign-off, mint and export share the mortgage flow. The funded Loan note now shows Loan type: HELOC.

## Pull requests: web portal

| PR | Title | Merged / state | By |
|---|---|---|---|
| [#206](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/206) | AL-213 Show the loan type on the funded loan note | 2026-11-15 (19ae889) | Nikoloz |
| [#280](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/280) | AL-333 Restyle the loan file with the 3D committee and blockchain stages | 2026-11-23 (3efeea3) | Nikoloz |
| [#141](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/141) | Queue and HELOC collateral | 2026-10-30 (origin/main history) | Nikoloz |
| [#190](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/190) | Stored policy conditions | 2026-11-12 (origin/main history) | Nikoloz |

## Main files changed

- al-web/src/pages/shared/LoanFilePage.tsx
- al-web/src/components/lending/HelocCollateral.tsx
- al-web/src/components/lending/LoanNotePanel.tsx

## How it was tested

Recorded commands were run in al-web, not during document preparation. PR #206: npm test 721 passed in recorded branch run; fresh focused panel/loan-file run 96 passed. npm run build passed with Vite bundle-size warning; betterleaks clean. Main mint/audit re-run passed 17 Nov; no new suite count supplied.

See test-case.md for individual browser, sample-preview, automated and Not run results.

## Limits and known issues

Browser HELOC sign-off Not run: seed already approved. The main mint/audit/type-display re-test passed 17 Nov. Committee real-run checks remain outstanding.

## Evidence

sprint3-facts.md (26 Nov 2026), linked PR bodies and origin/main at ebcfa88. Test counts are historical evidence, not new submission-preparation runs.
