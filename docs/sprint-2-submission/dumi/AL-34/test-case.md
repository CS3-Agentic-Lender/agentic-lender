# Test case: AL-34

**Story:** As an underwriter, an application moves through Applied, AI Deliberated, Approved, Funded, Closed

**Tested by:** Solomon Sosanya (Dumi)  
**Date run:** 8 Nov 2026  
**Build:** `main` at commit `440bfe7`

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core running on port 5002, a local Hardhat node with the contracts deployed (`cd al-core/chain && npx hardhat node`, then `npm run deploy:local`) and al-core started with the chain settings (see `al-core/README.md`, "The loan note and the mint").
- Seeded logins use the demo password from `al-core/scripts/seed.js`: alice@test.com (borrower), bob@test.com (broker), uma@test.com (underwriter).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Sign in as alice and `PATCH` her Draft with `"status": "Funded"` (an unknown field is ignored); then try to write `status` straight to Firestore from a client. | The status does not change. Only the seven agreed values exist. | `tests/test_status.py::test_the_table_is_exactly_the_agreed_moves`; Jest `rules.test.js` (no client can write an application) | ☑ Pass ☐ Fail |
| 2 | 2 | As alice, submit her Draft (`POST /core/applications/{id}/submit`). | Draft moves to Applied. | `tests/test_applications.py` (submit tests); `tests/test_status.py` | ☑ Pass ☐ Fail |
| 3 | 2 | With the AI listener on (`AUTO_START_COMMITTEE=true` in al-ai) and the Firestore emulator running, let the committee finish a run for an Applied application. | The application moves to AI Deliberated, with `aiRunStatus` complete. A failed run leaves it at Applied. | `al-ai/tests/test_auto_start.py` (23 tests against the Firestore emulator: one winner out of four simultaneous claims, a complete run moves the status, a failed run does not) | ☑ Pass ☐ Fail |
| 4 | 2 | As uma, approve the seeded AI Deliberated application (`POST /core/applications/{id}/decision` with `{"outcome":"approved"}`); try the same as bob (broker) and as alice. | uma: Underwriter Approved. bob and alice: 403, nothing changes. | `tests/test_decision.py`; `tests/test_status.py` (every move refused to every other actor) | ☑ Pass ☐ Fail |
| 5 | 2 | As uma, mint the approved loan (`POST /core/applications/{id}/mint`). | Funded, with the loan note on the local chain. Minting again returns the same note and mines nothing. | `tests/test_mint.py`; `tests/test_chain_live.py` against a real node; `scripts/smoke_close.py` (first check) | ☑ Pass ☐ Fail |
| 6 | 2 | As uma, close the funded loan (`POST /core/applications/{id}/close`), then close it again, then close the seeded Declined application, then try an Applied one. | Closed, and the loan note is Closed on the chain. The second call returns the same body and sends no transaction. The Declined one closes with no chain call. The Applied one is 409. | `tests/test_close.py` (23 tests) and `scripts/smoke_close.py` (16 checks against the emulators and the local chain) | ☑ Pass ☐ Fail |
| 7 | 2 | Try the moves the table does not allow: close an Applied application, approve a Draft, move a Closed one. | Each is 409 and nothing changes. | `tests/test_status.py::test_skips_reversals_and_leaving_closed_are_409` | ☑ Pass ☐ Fail |
| 8 | 3 | Read the application's `statusHistory` in the Emulator UI (localhost:4000) after the moves above. | One entry per move with `from`, `to`, `actor`, `actorId` and `at`; the actor is borrower, committee, underwriter or mint. | `tests/test_status.py::test_each_move_saves_who_made_it_and_when`; `test_auto_start.py` (the committee's entry has the same shape); `smoke_close.py` ("the move is logged once, by the underwriter") | ☑ Pass ☐ Fail |
| 9 | 4 | Look at an application whose AI run failed. | `aiRunStatus` is failed and the status is still Applied, with no history entry; the reason is on the `ai_runs` document, not on the application. | `al-ai/tests/test_auto_start.py` (a failed run leaves Applied, writes no history and no failure field on the application) | ☑ Pass ☐ Fail |
| 10 | 5 | Read the decision on which states touch the chain (comment of 29 Oct on the Jira ticket) and check the contract. | Only Funded (mint and audit hash) and Closed (note closed) touch the chain. | `chain/test/LoanNote.test.js` (Hardhat) | ☑ Pass ☐ Fail |

## Automated test run

On `main` at `440bfe7`, 8 Nov 2026:

- al-core `uv run pytest`: **685 passed, 7 skipped** (the 7 need a live chain).
- Jest under the Firestore emulator: **251 passed** in 5 suites (security rules and seed data).
- Hardhat (`npx hardhat test`): **47 passing**.
- Live chain: `tests/test_chain_live.py` against a local Hardhat node, **7 passed**.
- `scripts/smoke_close.py` against the emulators, the API and the local chain: **16 of 16 checks passed**. It mints the seeded approved application, closes it (one block mined), closes it again (no block mined), closes the Declined one with no chain call, and checks that a borrower and a broker get 403.
- al-ai `test_auto_start.py`, `test_auto_start_wiring.py` and the call log tests under the Firestore emulator: **33 passed**. I ran these on the AL-140 branch merged with `main`, because the listener is already on `main` and the branch only adds to it.

One thing that was red on `main` at that commit: four tests in `al-ai/tests/test_budget_before_first_call.py` fail, because two al-ai changes were each green on their own and broke each other once both merged. AL-300 fixes it (test code only, PR open). They don't test status moves.

## Notes

- I ran the checks in the Automated column, and the live script for steps 5, 6 and 8. I did not click through the Emulator UI by hand for steps 1 and 8, so those two rest on the automated tests and the script's log check.
- On 10 Nov 2026 step 6 was also run by hand against `main` with the emulators, the API and a fresh local node: mint gave Funded (token 1); the first close gave Closed with a close time and transaction; the second close returned the same time and transaction; the Declined application closed with no loan note; the Applied one was refused with a 409 saying only a Funded or Declined application can be closed; and the note on the chain read status 2 (closed). Step 3 was not run by hand: a real committee run needs the AI models, so it rests on `test_auto_start.py`.
- `smoke_close.py` leaves the seeded application Closed in the emulator and a note on the node, so I restarted both before running anything else.
