# AL-36: As an auditor, a SHA-256 hash of the credit memo, valuation and approval is stored on-chain

## What was built

I built a way to prove that an approved loan's paperwork has not been changed since the underwriter signed it off. When the decision is saved, al-core puts the important parts into one record: the decision, the risk tier, the credit memo, the loan type, amount and term, and a fingerprint of every AI call the committee made. The record's keys are sorted and it has no spaces, so the same record always gives exactly the same bytes. I then take the SHA-256 of those bytes. This is one shared function, and al-ai's tests load the same test vectors, so the two services always produce the same hash.

The hash is written to a small contract called `AuditRegistry`. It accepts a hash for an application once and never again, so nobody can swap it afterwards. Only the hash and a hash of the application id go on the chain. There are no names and no amounts in clear.

The audit pack endpoint rebuilds the hash from what is stored and compares it with three others: the one we saved, the one on the loan note and the one on the chain. If any of them differ, it says not verified. I tested this live. I changed one character of the stored credit memo and it said not verified. I put the character back and it said verified again.

The last piece is the AI calls. The record lists each call by its id and hash, so the calls have to exist as documents. The pull request that saves every call for real runs (#177) is now merged, so a real run saves its calls beside the finished run.

## Pull requests: this story

| PR | Title | Merged | By |
|---|---|---|---|
| [#100](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/100) | AL-253 Add the shared audit hash function and test vectors | 2026-10-27 | Dumi |
| [#102](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/102) | AL-171 Add the audit registry contract with Hardhat tests | 2026-10-27 | Dumi |
| [#107](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/107) | AL-268 Add a non-ASCII vector to the audit hash test vectors | 2026-10-28 | Dumi |
| [#148](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/148) | AL-172 Build the audit record, hash it and write the hash to the registry | 2026-10-31 | Dumi |
| [#160](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/160) | AL-283 Put the loan type, amount and term in the audit record | 2026-11-04 | Dumi |
| [#177](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/177) | AL-140 Save every AI call as an ai_calls document | 2026-11-10 | Dumi |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#154](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/154) | AL-66 Add the endpoint that mints the loan note | 2026-11-03 | Dumi |
| [#161](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/161) | AL-161 Add the audit pack endpoint | 2026-11-03 | Dumi |
