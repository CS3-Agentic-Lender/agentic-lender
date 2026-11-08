# AL-34: As an underwriter, an application moves through Applied, AI Deliberated, Approved, Funded, Closed

## What was built

I built the part that decides which status an application can move to, and who is allowed to move it. There are seven statuses. One table in `al-core/app/status.py` lists every move that is allowed and who can make it: the borrower submits, the AI committee moves it to AI Deliberated when a run finishes, the underwriter approves or declines, the mint step marks it Funded, and the underwriter closes it. Any other move is refused with a 409 and nothing changes. Every move also writes an entry to the application's `statusHistory` (from, to, who, when), which is what the apps use for the status timeline.

This sprint I added the last step, closing. When the underwriter closes a funded loan, the loan note on the blockchain is closed first and only then does the status change, so the two can't disagree. If the chain call works but saving fails, running it again finds the note already closed and finishes the job without sending a second transaction. A declined application can be closed too, and it has no note, so it doesn't touch the chain.

Nic's listener (#176) moves an application to AI Deliberated when the committee run completes. A run that fails leaves it at Applied, and the reason is kept on the run record, not on the application.

## Pull requests: this story

| PR | Title | Merged | By |
|---|---|---|---|
| [#129](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/129) | AL-169 Enforce the allowed status moves and record who made each | 2026-10-29 | Dumi |
| [#175](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/175) | AL-293 Add the close endpoint for funded and declined applications | 2026-11-07 | Dumi |

## Pull requests: the moves this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#133](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/133) | AL-166 Save the sign-off decision and move the status | 2026-10-30 | Dumi |
| [#154](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/154) | AL-66 Add the endpoint that mints the loan note | 2026-11-03 | Dumi |
| [#176](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/176) | AL-141 Start the committee automatically when an application becomes Applied | 2026-11-07 | Nic |
| [#134](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/134) | AL-59 Test that clients can listen to an application's status in real time | 2026-10-30 | Dumi |
