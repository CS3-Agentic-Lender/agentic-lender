# Sprint 3 retrospective: Dumi (database, blockchain and the al-core API)

## What went well

- Both contracts are on Polygon Amoy and verified, and a loan note has been minted from the live AWS deployment, not only from my laptop (AL-183). The audit hash went on the registry first, then the note was minted, which is the order the design asked for.
- Running against the real testnet found two faults the tests could not: Amoy blocks carry extra data that web3.py rejects by default, and the public RPC refuses log searches over more than 10,000 blocks. I fixed both (AL-331) with a windowed search, and tests that copy the RPC's limit.
- The order of deploys was planned. The rule that stops brokers reading the AI calls (AL-334) was deployed only after the portal stopped asking for them (#280), so nobody saw a permission error. A live check of 96 requests against the hosted rules passed afterwards.
- A 500 error can now be traced: every request writes one log line with its request id (AL-330), so the id a user sees can be found in the AWS logs.
- The Stripe webhook was tested end to end on AWS and returned 200 (AL-72).

## What did not go well

- I pasted wallet keys into Slack once. I deleted the messages and replaced the minter wallet the same day, and from then on secrets went only by one-time Bitwarden Sends. Nothing was lost, since they were testnet wallets, but it should not have happened.
- The first mint from AWS failed with "no rate yet", because al-ai never wrote the rate the mint reads. This only showed in the live run, and needed a fix on Nic's side before the mint could work.
- Two of my pull request descriptions (#255, #256) named other tickets' keys, which our rules forbid, because Jira can close the wrong ticket. I caught and removed them, but they should not have been written.
- The admin work for al-core (the staff API and the admin rules) merged inside a web pull request (#284) with no core review, although we had agreed it would come to me as its own pull requests. I reviewed it after it merged: the code was sound, but a rules change should never merge unseen by the person who owns the rules.
- Getting test POL took longer than it should have. Most faucets wanted mainnet funds, and only the official Polygon faucet worked.

## What I learned

- **A testnet is not a local chain.** Real RPC limits and block formats only show up against the real network, so a live run belongs early in the ticket, not at the end.
- **Plan the deploy order when a rules change and a UI change depend on each other.** Deploying the rules first would have broken the broker's screen.
- **Secrets need a channel of their own,** decided before they are needed, not when someone asks for them.

## Sprint 2 actions: did they happen?

| Action | Result |
|---|---|
| Merge `main` in and re-run the tests before approving the next PR | _Dumi to fill in_ |
| Put the blocking questions at the top of the ticket and ask in `#dev` the same day | _Dumi to fill in_ |
| Post the retro and submission dates on day one | _Dumi to fill in_ |
| Contracts on a public testnet (AL-183), al-core image ready for AWS (AL-212) | Done: both contracts verified on Amoy, al-core running on AWS, and a note minted from it |

## Actions for after Sprint 3

| Action | Owner | How we'll know |
|---|---|---|
| Any change to `firestore.rules` goes in its own pull request with a core review, whoever writes it. | Everyone (agreed with Nic, 26 Nov) | No rules change merges without my review. |
| Run the live check of the hosted rules (`check-hosted-rules.js`) after every rules deploy. | Me | Each deploy has a passing check recorded on its ticket. |
| Rehearse the demo end to end on the live site before 4 January: a borrower applies, the committee runs, the underwriter signs off and a note is minted on Amoy. | Everyone | One full run works with no fixes on the day. |
