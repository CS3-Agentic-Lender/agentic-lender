# AL-151: As an underwriter, I sign off an application and my decision is recorded

## What was built

A Sign off panel on AI Deliberated applications for underwriters only: the AI recommendation as advice, a required justification, Approve and Decline, a confirm dialog, then one call to the decision endpoint. The new status comes from Firestore, not from the screen. This also adds the portal's API client.

## Pull requests: web portal

| PR | Title | Merged | By |
|---|---|---|---|
| [#189](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/189) | AL-165 Add the sign-off panel and the API client | open, review fix pushed | Nikoloz |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#133](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/133) | AL-166 Save the sign-off decision and move the status | 2026-10-30 | Dumi |
| [#129](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/129) | AL-169 Enforce the allowed status moves and record who made each | 2026-10-29 | Dumi |
