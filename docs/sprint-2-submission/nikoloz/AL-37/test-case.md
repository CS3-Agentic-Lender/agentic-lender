# Test case: AL-37

**Story:** As an underwriter, signing off an application from the portal triggers the loan note mint

**Tested by:** Nikoloz Chilachava  
**Date run:** 10 Nov 2026  
**Build:** `feature/AL-159-minting-progress` at commit `b66c456` (PR #191, open)

## Preconditions

- Firebase emulators started with the seed data from main's al-core (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), and the portal running (`npm run dev` in `al-web`). Seeded logins use the demo password from `al-core/scripts/seed.js`.
- The al-core API running locally against the emulators.
- A local Hardhat node running, with the contracts deployed (`npm run deploy:local` in `al-core/chain`).
- Signed in as uma@test.com (underwriter).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 1 | Open the loan file for the seeded HELOC `app-approved` (status Underwriter Approved) and click "Mint loan note". | The portal starts the mint through the API and shows progress until the transaction is confirmed. | loan-file.test.tsx, settlementService.test.ts | ☑ Pass ☐ Fail |
| 2 | 2 | Wait for the mint to finish and read the header and the Loan note panel. | The status becomes Funded. The panel shows the token ID and the transaction hash, with a block-explorer link on the testnet. | LoanNotePanel.test.tsx, loan-file.test.tsx | ☐ Pass ☐ Fail |
| 3 | 3 | Open `app-deliberated` (Underwriter Approved, its audit hash already anchored on this chain by an earlier run) and click "Mint loan note", then "Retry mint". | The mint fails, the application stays Underwriter Approved with the error shown, and "Retry mint" tries again without creating a second note. | loan-file.test.tsx, apiClient.test.ts | ☐ Pass ☐ Fail |
| 4 | 4 | After step 2, read the audit rows of the Loan note panel. | The decision's audit hash is stored on-chain in the same flow, and its transaction shows next to the mint's. | LoanNotePanel.test.tsx | ☑ Pass ☐ Fail |

## Automated test run

al-web Vitest on `feature/AL-159-minting-progress` at `b66c456`, 10 Nov 2026: **545 passed, 0 failed**. The build (`npm run build`: `tsc -b` then `vite build`) passed.

## Notes

- Step 1: "Minting..." showed, then the Loan note panel. The mint went through the real al-core API, which signs the transaction.
- Step 2: the header turned Funded through the live listener. The panel showed token id 2, network Local Hardhat chain, mint transaction `0xe7de53ddfbf83aad06e817f91945c08fac6151d1067e11ec65c8bc26eba3afab` and contract `0x5FbDB2315678afecb367f032d93F642f64180aa3`. Not run yet: the block-explorer link, because a local Hardhat chain has no explorer and the testnet is not deployed yet. The testnet links are unit tests only (LoanNotePanel.test.tsx).
- Step 3: the API returned 502 "a different audit hash is already stored for this application". The panel showed "The request failed. Please try again." with "Retry mint" and no note. The generic text was because the API client did not yet read al-core's error message; that is fixed in the sign-off PR (#189, commit `e4a2dd9`). Not run yet: clicking "Retry mint" in the browser and checking that no second note is created. A single retry on a double click is unit tested (loan-file.test.tsx).
- Step 4: audit hash `e68205a7ecc21749a177c47528af5231f255586412b93b668f338a3e14745065`, audit registry transaction `0x501b04b87ffe5a792670bc7798102d24040095bac7e0d107d3ae541f33f09bd0`, shown in the same panel as the mint transaction.
- The mint changes the emulator data and the local chain. Re-import the seed data and restart the Hardhat node to reset them.
