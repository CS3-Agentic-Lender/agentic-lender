# Test case: AL-36

**Story:** As an auditor, a SHA-256 hash of the credit memo, valuation and approval is stored on-chain

**Tested by:** Solomon Sosanya (Dumi)  
**Date run:** 8 Nov 2026 (step 5 on 10 Nov 2026)  
**Build:** `main` at commit `440bfe7`; step 5 on `main` at `e918597`, after the AL-140 pull request (#177) merged.

## Preconditions

- Same set-up as AL-34: emulators with the seed, al-core with the chain settings, a local Hardhat node with the contracts deployed.
- Seeded login uma@test.com (underwriter). The seeded `app-approved` has a complete AI run, its calls and a decision, so it can be minted.

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Mint `app-approved` (`POST /core/applications/{id}/mint`), then try to store a different hash for the same application directly on the contract. | The hash is stored with a time. The second write is refused (`AlreadyStored`) and the stored hash is unchanged. | `chain/test/AuditRegistry.test.js` (Hardhat: 47 passing); `tests/test_chain_live.py` against a real node | ☑ Pass ☐ Fail |
| 2 | 2 | Read `applications/app-approved/audit/record` in the Emulator UI, and read the audit record section of `al-core/SCHEMA.md`. | A record with sorted keys: decision, risk tier, credit memo, underwriter id, sign-off time, loan type, amount in cents, term in months and the id and SHA-256 of each AI call. The rule for turning it into the hash is written down. | `tests/test_audit_record.py`; Jest `audit-hash-vectors` test (the shared examples are up to date) | ☑ Pass ☐ Fail |
| 3 | 3 | `GET /core/applications/{id}/audit-pack` for the minted application. Then change one character of `creditMemo` in `applications/app-approved/audit/record` in the Emulator UI and ask again. Put the character back and ask a third time. | First: `verified` is true (the record hash, the stored hash, the loan note's hash and the registry's all agree). After the change: `verified` is false. After putting it back: true again. | `tests/test_audit_pack.py` (a record changed after it was hashed is not verified; a call changed or gone is flagged); `tests/test_audit.py::test_changing_one_character_changes_the_hash` | ☑ Pass ☐ Fail |
| 4 | 4 | Look at what was sent to the chain (the registry's `recordOf` and the transaction) for the application. | Only a 32-byte hash and a SHA-256 of the application id: no name, no uid, no amount in clear. | `tests/test_chain.py`; `chain/test/LoanNote.test.js` (the borrower reference does not reveal the uid) | ☑ Pass ☐ Fail |
| 5 | 2 | Run a committee run with the AI listener (or `python -m app.committee`) and read the `ai_calls` documents for the run. | One document per model attempt, search and valuation-model call, with the id the run record lists; the audit record lists exactly those. | `al-ai/tests/test_call_log.py` (19 tests) and `test_call_log_firestore.py` (4 tests against the emulator) | ☑ Pass ☐ Fail (the automated tests, not a live committee run: see the notes) |

## Automated test run

On `main` at `440bfe7`, 8 Nov 2026: al-core `uv run pytest` **685 passed, 7 skipped**; Jest under the emulator **251 passed**; Hardhat **47 passing**; `tests/test_chain_live.py` against a local node **7 passed**.

For step 5, on `main` at `e918597` (10 Nov 2026, after #177 merged): the call log, call log Firestore, listener and listener wiring tests, and the approval likelihood tests, all under the Firestore emulator, **87 passed**.

## Notes

- Step 3, run live against the emulators, the API and a local node: the mint returned 201 and the audit hash `e68205a7…745065`. The audit pack said `verified: true`, with the computed hash, stored hash, loan note hash and on-chain hash all equal to it. I changed the last character of the record's credit memo from `.` to `!`: `verified` was false. I put it back: true again.
- The change has to be made in the audit record (`applications/{id}/audit/record`), not in `ai_runs`. The record keeps its own copy of the memo, and the pack hashes that copy. Changing the memo in `ai_runs` after sign-off doesn't change the pack, because the record is what was hashed. I found this while testing: my first attempt changed `ai_runs` and `verified` stayed true.
- Step 5 is ticked from the automated tests on `main`, run under the Firestore emulator. I did not run a live committee run, because that needs the AI models, which need Ollama. The `ai_calls` documents for a real run are written by the listener, and the listener tests check that they are saved beside the finished run.
