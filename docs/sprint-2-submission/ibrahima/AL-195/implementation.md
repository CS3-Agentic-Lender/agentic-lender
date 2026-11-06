# AL-195: As a homeowner, I apply for a home equity line of credit against my property's value

## What was built

Implemented the mortgage-or-HELOC choice, the HELOC check with its credit line, and the HELOC application, plus fixes to how euro amounts are formatted.

## Pull requests: iOS app

| PR | Title | Merged | By |
|---|---|---|---|
| [#62](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/62) | AL-206 Ask mortgage or HELOC before the affordability check | 2026-10-22 | Ibrahima |
| [#112](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/112) | AL-207 Add the HELOC check: calculate and show the credit line | 2026-10-27 | Ibrahima |
| [#143](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/143) | AL-208 Apply for a HELOC from its check | 2026-10-30 | Ibrahima |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#95](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/95) | AL-198 Add HELOC calculations and the HELOC affordability endpoint | 2026-10-21 | Nic |
| [#120](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/120) | AL-197 Stop a HELOC needing an asking price and index the queue by loan type | 2026-10-30 | Dumi |

## Fixes found in testing

| PR | Title | Merged | By |
|---|---|---|---|
| [#158](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/158) | AL-250 Regroup euro amounts on screen after every edit | 2026-11-03 | Ibrahima |
| [#166](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/166) | AL-286 Keep the regrouped amount on screen when digits are typed quickly | 2026-11-06 | Ibrahima |

> AL-205 (the HELOC wireframes) has no PR: it was design work only.
