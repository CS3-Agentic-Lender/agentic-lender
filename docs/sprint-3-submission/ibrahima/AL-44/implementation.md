# AL-44: As a borrower, I pay a fast-track appraisal fee through Stripe Sandbox

## What was built

Built the €150 fast-track offer on the status screen, Stripe's payment sheet, and the wait for al-core's webhook before showing the receipt and "Fast-track paid".

## Pull requests: iOS app

| PR | Title | Merged | By |
|---|---|---|---|
| [#242](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/242) | AL-148 Add the fast-track appraisal fee with Stripe's payment sheet | 2026-11-18 | Ibrahima |

## Pull requests: backend and portal this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#222](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/222) | AL-72 Add the fee intent endpoint and the Stripe webhook | 2026-11-18 | Dumi |
| [#240](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/240) | AL-322 Pass the Stripe settings into the al-core container | 2026-11-18 | Dumi |
| [#246](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/246) | AL-323 Name the environment in the fee idempotency key and refuse a new intent that is not open | 2026-11-18 | Dumi |
| [#233](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/233) | AL-319 Sort fast-track applications first in the underwriter queue | 2026-11-21 | Nikoloz |
