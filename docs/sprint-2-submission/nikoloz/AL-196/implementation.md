# AL-196: As an underwriter, I review a HELOC application with its combined LTV and collateral value

## What was built

The queue shows each application's loan type with an All / Mortgage / HELOC filter, and a HELOC loan file shows the estimated value, existing balance, credit limit and combined LTV against the 80% cap, the stored policy conditions (surveyor valuation) and the "requires lender exception review" warning on a cap breach. Sign-off, mint and the audit pack are shared with mortgages; committee reasoning for HELOC files comes with the deliberation console.

## Pull requests: web portal

| PR | Title | Merged | By |
|---|---|---|---|
| [#141](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/141) | AL-213 Show the loan type in the queue and the HELOC collateral in the loan file | 2026-10-30 | Nikoloz |
| [#190](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/190) | AL-213 Show the stored HELOC policy conditions and drop the asking price row | open, approved | Nikoloz |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#169](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/169) | AL-287 Document and seed the stored valuation fields and the HELOC surveyor condition | 2026-11-06 | Dumi |
| [#200](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/200) | AL-305 Save the policy gate result on the review document and the run record | open | Nic |
