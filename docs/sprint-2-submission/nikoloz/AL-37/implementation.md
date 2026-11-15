# AL-37: As an underwriter, signing off an application from the portal triggers the loan note mint

## What was built

After approval the loan file mints the loan note through al-core and shows "Minting..." until it is stored, then a Loan note panel with the token id, network, mint transaction, contract, audit hash and audit registry transaction. A failed mint shows the reason and a Retry button and never shows a note that was not stored.

## Pull requests: web portal

| PR | Title | Merged | By |
|---|---|---|---|
| [#191](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/191) | AL-159 Mint the loan note after approval and show its result | 2026-11-12 | Nikoloz |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#154](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/154) | AL-66 Add the endpoint that mints the loan note | 2026-11-03 | Dumi |
| [#148](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/148) | AL-172 Build the audit record, hash it and write the hash to the registry | 2026-10-31 | Dumi |
