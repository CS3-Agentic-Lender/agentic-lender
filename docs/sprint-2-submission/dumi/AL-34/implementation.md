# AL-34: As an underwriter, an application moves through Applied, AI Deliberated, Approved, Funded, Closed

## What was built

I built the part that controls how a loan application moves through its stages. There are seven statuses: Draft, Applied, AI Deliberated, Underwriter Approved, Declined, Funded and Closed. I put every allowed move in one table in `al-core/app/status.py`, together with who is allowed to make it. The borrower submits, the AI committee moves it to AI Deliberated when its run finishes, the underwriter approves or declines, the mint step marks it Funded, and the underwriter closes it. I used one table so the rules are in one place and cannot disagree with each other. If anyone tries a move that is not in the table, such as skipping a stage or going backwards, the API answers 409 and nothing changes. Every move that does happen is saved in the application's `statusHistory` with where it came from, where it went, who did it and when. The apps use that to draw the status timeline.

This sprint I added the last step, closing a loan. When the underwriter closes a funded loan, the loan note on the blockchain is closed first, and only after that does the status change to Closed. I did it in that order so the database can never say Closed while the note on the chain is still open. If the chain step works but saving to the database fails, running the close again finds the note already closed and just finishes saving, without sending a second transaction. A declined application can also be closed. It never had a loan note, so nothing is sent to the chain.

Nic built the part that moves an application to AI Deliberated (#176). When the committee finishes a run, his listener makes the move. If a run fails, the application stays at Applied, and the reason is kept on the run record, not on the application.

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
