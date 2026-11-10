# AL-31: As a borrower, I see my estimated LTV, DTI and approval likelihood

## What was built

Added the LTV, DTI and approval likelihood figures to the status screen.

## Pull requests: iOS app

| PR | Title | Merged | By |
|---|---|---|---|
| [#145](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/145) | AL-145 Show LTV, DTI and approval likelihood on the status screen | 2026-10-30 | Ibrahima |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#103](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/103) | AL-252 Return ltv_band and risk_tier from GET /core/applications/{id} | 2026-10-27 | Dumi |
| [#172](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/172) | AL-63 Add the approval likelihood rule and the fields the listener will write | 2026-11-06 | Nic |
| [#185](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/185) | AL-63 Write the borrower's figures on submit and recalculate them when a run completes | 2026-11-09 | Nic |

> Still open: [#196](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/196) (AL-303, Ibrahima) makes each explanation in the "What do these mean?" sheet one sentence. Add it to the iOS table once it is merged.
