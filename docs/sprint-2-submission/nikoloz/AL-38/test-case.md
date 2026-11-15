# Test case: AL-38

**Story:** As an underwriter, I download a PDF/CSV audit pack for a decision

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-160-audit-pack-download` at commit `7328a15` (PR #192, open; review fix `d040e0b` pushed on 12 Nov)  
**Re-run:** 15 Nov 2026 on `main` at `f41a283` (after #194 merged), emulators started from main's seed with the al-core API running; no local chain.

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- The al-core API running locally against the emulators.
- A local Hardhat node running, with the contracts deployed (`npm run deploy:local` in `al-core/chain`).
- `app-approved` minted on that chain (the AL-37 test case, step 2).
- Signed in as uma@test.com (underwriter).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for `app-approved` and click "Download PDF". Open the file. | A PDF with the application summary, valuation, affordability figures, each agent's vote, the credit memo, the underwriter's decision and justification, and the on-chain transaction hashes. | AuditPackActions.test.tsx, auditExports.test.ts | ☐ Pass ☑ Fail |
| 2 | 2 | Click "Download CSV" and open the file in Excel. | The same figures, one field per row, opening cleanly in Excel. | auditExports.test.ts | ☑ Pass ☐ Fail |
| 3 | 3 | Read the hash rows of the CSV and the verification line on the page. | The pack holds the SHA-256 audit hash, and recomputing it from the canonical record gives the hash stored on-chain. | AuditPackActions.test.tsx | ☑ Pass ☐ Fail |
| 4 | 4 | Download the pack as the broker of the client (ciara@test.com), then try as another broker. | Underwriters and the client's own broker can download it; anyone else is refused. | AuditPackActions.test.tsx | ☑ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-160-audit-pack-download` at `7328a15`, 10 Nov 2026: **578 passed, 0 failed**. After the review fix `d040e0b`, 12 Nov 2026: **588 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- Step 1: re-run on 15 Nov on `app-closed` (the seeded loan note, token id 7), because `app-approved` needs a mint on a local chain. "Download PDF" gave a 3-page PDF (12,804 bytes) that opens in strict mode. It holds the application summary, the valuation with each feature's contribution, the affordability figures, the credit memo, the underwriter's decision and reason, the mint transaction hash and the audit hash. Fail: it does not hold each agent's vote. The agent rows list provider, model, output and hash only, because the al-core audit pack response has no vote field and the portal does not add the votes from the committee run.
- Step 2: re-run on 15 Nov on `app-closed`. "Download CSV" gave 6,478 bytes. Opened in Excel: 152 rows and 3 columns (`section,field,value`), one field per row, and the credit memo with commas stayed in one cell. It has the same figures as the PDF, so it is also missing the votes (criterion 1).
- Step 3: `computed_hash`, `stored_hash`, `loan_note_hash` and `on_chain_hash` were all `e68205a7...5065`, with `on_chain_checked` true and `verified` true. The page showed "Verified: the record, the loan note and the registry agree." The hash is recomputed by al-core from the canonical record; the portal shows the result.
- Step 4: run on 15 Nov on `app-closed`. In the portal, Ciara (the client's broker) downloaded the same 6,478-byte CSV from her loan file. Bob (another broker) got "Application not available" on that loan file. Against the API: underwriter 200, Ciara 200, Bob 404 "No application with that id", Ben (the borrower) 403 "Your role cannot do this".
