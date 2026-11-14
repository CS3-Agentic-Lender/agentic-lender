# Test case: AL-39

**Story:** As a borrower, I see my loan note's on-chain lifecycle status

**Tested by:** Ibrahima Toure  
**Date run:** 6 Nov 2026  
**Build:** `main` at commit `66e32f0`

## Preconditions

- Firebase emulators started with the seed data (`firebase emulators:start --project demo-al --import=./seed-data` in `al-core`), al-core and al-ai running locally, the app on the iPhone 17 simulator. Seeded logins use the demo password from `al-core/scripts/seed.js`.
- Local Hardhat node running with the contracts deployed (`npm run deploy:local`). Signed in as ben@test.com on his seeded `app-approved` (Underwriter Approved, with a complete AI run).

## Steps

| # | Criterion | Steps | Expected result | Automated check | Result |
|---|---|---|---|---|---|
| 1 | 4 | Open an application that is not Funded yet. | The section reads "Your loan note will appear here once the bank approves and funds your loan". | LoanNoteTests.BeforeMintingTheSectionWaits | ☑ Pass ☐ Fail |
| 2 | 1 | Mint the loan note as uma@test.com through al-core's mint endpoint (the portal's sign-off screen is not built yet; see Notes), and watch the app. | The loan note appears: token ID, principal, APR, term and mint date. | UI: LoanNoteUITests.TheLoanNoteFillsInWhenTheApplicationIsFunded; unit: LoanNoteTests.AMintedNoteShowsItsFiveRowsAsIn14c | ☑ Pass ☐ Fail |
| 3 | 2 | Look for the explorer link on the local chain. | On the local chain there is no link; the full transaction hash shows instead. | LoanNoteTests: OnTheLocalChainThereIsNoLinkSoTheHashShows, WithAnExplorerSetTheLinkOpensTheMintTransaction | ☑ Pass ☐ Fail |
| 4 | 3 | Read the note back from the contract (`noteOf(tokenId)`) and compare. | Principal, APR, term and mint date match the app. | Manual check only (done in this run, see Notes) | ☑ Pass ☐ Fail |

## Automated test run

iOS unit tests (`AgenticLenderTests`) on `main` at `66e32f0`, iPhone 17 simulator (iOS 26.5), 6 Nov 2026: **651 passed, 0 failed, 0 skipped**. The UI tests named above (`AgenticLenderUITests`) need the emulators running and were not part of this run.

## Notes

- Home shows the newest-created application, so `app-approved` had its `createdAt` set to 6 Oct for the run and put back to 25 Sep after.
- Before minting, the section read "Your loan note will appear here once the bank approves and funds your loan" and the timeline "waiting for the loan note to be minted".
- Minted with POST /core/applications/app-approved/mint as uma@test.com (201, status Funded). With the status screen open, the note appeared within 5 seconds: token #1, €60,000, 4.0%, 15 years, minted 6 Nov 2026, and the timeline moved to Funded.
- On the local chain there is no explorer link, so the full mint transaction hash shows (0x930a7bc4…0144c2), with no stray hyphen where it wraps.
- Read back from the contract with noteOf(1): principal 6,000,000 cents, 400 bps, 180 months, minted 2026-11-06 22:36:29 UTC, status Active. All match the app. The mint transaction is in block 4.
