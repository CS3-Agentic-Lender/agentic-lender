# AL-23: As an underwriter, I compare the seller's asking price against the model's valuation

## What was built

A Collateral panel in the mortgage loan file: asking price, the model estimate (labelled as an estimate of a 2024 asking price, not a valuation) with its model version, the signed gap, a "Price needs review" badge only when the stored flag is set, the support warnings, and the purchase-price and indicative LTVs against the 90% limit. A missing value says so instead of showing zero.

## Pull requests: web portal

| PR | Title | Merged | By |
|---|---|---|---|
| [#188](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/188) | AL-155 Add the mortgage collateral panel to the loan file | open, approved | Nikoloz |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#162](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/162) | AL-61 Save the model estimate and price gap on the review document | 2026-11-04 | Nic |
