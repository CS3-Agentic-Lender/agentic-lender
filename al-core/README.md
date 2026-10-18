# al-core: local dev setup

## Prerequisites

- Node.js 22+
- Java (JDK 21+) — required by the Firebase emulators
- `npm install -g firebase-tools`
- [uv](https://docs.astral.sh/uv/) for the Python API (`uv --version` to check)

## Start the emulators

From `al-core/`:

```
firebase emulators:start --project demo-al --import=./seed-data
```

Emulator UI: http://127.0.0.1:4000

This setup runs the Firebase Emulator Suite directly via `firebase-tools` — no Docker involved.

## Seeded users

Password for all: `password123`

Roles live in the Firebase Auth custom claim (`role`) set on each user — the `role` field on the `users` Firestore document is just a convenience copy. The backend and rules read the role from the ID token claim, not the document field.

| Email | uid | Role | Notes |
|---|---|---|---|
| alice@test.com | `borrower1` | borrower | Chose broker Bob |
| ben@test.com | `borrower2` | borrower | Chose broker Ciara |
| bob@test.com | `broker1` | broker | |
| ciara@test.com | `broker2` | broker | |
| uma@test.com | `underwriter1` | underwriter | |

## Seeded applications

One application in every status, so each screen has something to show. The field list is in [SCHEMA.md](SCHEMA.md).

| id | Status | Borrower | Broker | Also seeded |
|---|---|---|---|---|
| `app-draft` | Draft | Ben | Ciara | |
| `app-applied` | Applied | Alice | Bob | Messages |
| `app-deliberated` | AI Deliberated | Alice | Bob | Review, AI run and calls, messages |
| `app-approved` | Underwriter Approved | Ben | Ciara | Review, AI run and calls, decision. A HELOC |
| `app-declined` | Declined | Ben | Ciara | Review, AI run and calls, decision, messages. No audit record |
| `app-funded` | Funded | Alice | Bob | Review, AI run and calls, decision, loan note, audit record |
| `app-closed` | Closed | Ben | Ciara | Review, AI run and calls, decision, loan note, audit record |

The loan notes and audit hashes are sample values: nothing is on a chain yet. Each audit hash is still computed the way the API design doc describes, so it can be re-checked from the stored record.

## Connect from your dev build

| Platform | Auth | Firestore |
|---|---|---|
| Web | `localhost:9099` | `localhost:8080` |
| iOS Simulator | `localhost:9099` | `localhost:8080` |

## Re-seeding

If you change the schema or seed data, regenerate the export:

```
firebase emulators:start --project demo-al
node scripts/seed.js
firebase emulators:export ./seed-data --project demo-al --force
```

Start the emulators **without** `--import` here, so the export holds only what the script writes. To see what the script would write without touching the emulators, run `node scripts/seed.js --dry-run`.

## Running the rules tests

```
npm install
npx jest
```

Requires the emulator (above) running in a separate terminal on port 8080.
## Running the API (port 5002)

The al-core API is a FastAPI service on port 5002, under `/core/*`. With the emulators running, from `al-core/`:

Windows PowerShell:

```
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
uv run uvicorn app.main:app --port 5002 --reload
```

macOS / Linux:

```
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 uv run uvicorn app.main:app --port 5002 --reload
```

Check it: http://127.0.0.1:5002/core/health returns `{"status": "ok"}`. Interactive docs: http://127.0.0.1:5002/core/docs

Every request except `/core/health` needs `Authorization: Bearer <Firebase ID token>`. The role comes from the token's `role` claim. Errors use the shared shape in `docs/api-design.md` and every response carries `X-Request-ID`.

With Docker instead:

```
docker build -t al-core .
docker run -p 5002:5002 -e FIREBASE_AUTH_EMULATOR_HOST=host.docker.internal:9099 -e FIRESTORE_EMULATOR_HOST=host.docker.internal:8080 al-core
```

## Running the API tests

```
uv run pytest
```

These need no emulator.

## Endpoints

| Endpoint | Who | What |
|---|---|---|
| `POST /core/me` | Any signed-in user without a staff role | Creates the borrower profile in `users/{uid}` and sets the `role: borrower` claim. First call `201`, repeat calls `200` with the existing profile unchanged. Bad input `422` naming the field, including an `email` that doesn't match the one the user signed in with. |
| `GET /core/me` | Any signed-in user | The caller's profile, or `404` if there is none yet |

After `POST /core/me` the app must refresh its ID token (`getIdToken(true)`) so the token carries the new `role` claim.

End-to-end check against the emulators (API running as above, from `al-core/`):

```
uv run python scripts/smoke_me.py
```

## Blockchain: the loan note contract (`chain/`)

The blockchain half of al-core is a Hardhat project in `al-core/chain/`, separate from the Firebase tooling so the two test runners never pick up each other's tests.

`contracts/LoanNote.sol` mints one token per approved loan.

**Why ERC-721 (OpenZeppelin) rather than a plain stateful contract.** Each loan is unique and owned, which is exactly what an ERC-721 token models. OpenZeppelin's implementation is standard and audited, so we only write the loan logic. Block explorers and wallets understand ERC-721, so once it's on the testnet a note can be looked up like any other token.

**What's stored per note:** principal in euro cents, APR in basis points (4.25% = 425), term in months, loan type (mortgage or HELOC), the status (active or closed) and when it was minted and closed.

**No personal data on-chain.** The note holds two references made by al-core:
- `applicationRef`: SHA-256 of the application id. It also stops a second mint for the same application.
- `borrowerRef`: SHA-256 of a secret salt and the borrower's uid. The salt stays in al-core, so nobody can work back from the chain to a person.

**Who can do what:** only accounts with `MINTER_ROLE` (al-core's wallet) can mint or close a note. The admin (the deployer) can hand the role to a new wallet. A closed note can't be reopened, and an application can only be minted once.

**Who holds the notes:** every note is minted to one `holder` address (the bank), fixed when the contract is deployed. It is kept separate from the minter, so if al-core's wallet is replaced, the notes already minted stay with the bank instead of being stranded in the old wallet. The constructor refuses a zero address for the admin, minter or holder. The holder is fixed for the life of the contract, so moving the notes to a new bank wallet means deploying a new contract. That's a known limit, fine for this project.

**Notes can't be transferred.** A note is the bank's record of a loan, not something traded in this app, so the contract only allows minting: any transfer, of an active or a closed note, reverts with `NotTransferable`. A real lender sometimes sells loans on, so a production version might allow active notes to move between approved holders. That is left as future work because nothing in the app needs it.

Run the contract tests (no node or emulator needed):

```
cd chain
npm install
npx hardhat test
```

### Running a local chain

Two terminals, from `al-core/chain/`:

```
npx hardhat node
```

starts a local chain on `http://127.0.0.1:8545` with 20 funded test accounts (test keys only, printed by Hardhat, never used anywhere real). Then:

```
npm run deploy:local
npm run demo:local
```

(the same as `npx hardhat run scripts/deploy.js --network localhost` and `scripts/demo-mint.js`.)

`deploy.js` deploys the loan note and saves its address to `deployments/localhost.json`, which al-core will read to find the contract once minting is wired in. `demo-mint.js` mints an example note with made-up references, reads it back and shows that a second mint for the same application is refused. The local chain starts empty each time, so deploy again after restarting the node: `demo-mint.js` says so if the saved address has no contract behind it.

### Choices for the chain

- **Who signs transactions:** al-core, with a server-held testnet wallet (web3.py). The underwriter clicks sign-off in the portal and the API mints, so nobody needs a browser wallet. The wallet's address gets `MINTER_ROLE` at deploy (`MINTER_ADDRESS`, defaulting to the deployer for local work). The notes themselves go to a separate bank address (`HOLDER_ADDRESS`, also defaulting to the deployer), so replacing al-core's wallet never moves them.
- **Libraries:** Hardhat and ethers.js for the contracts, tests and scripts; web3.py in al-core for minting.
- **Where the chain runs:** a local Hardhat node for development. The live site can't reach a node on a laptop, so it will use a public testnet, most likely Polygon Amoy, set up in Sprint 3 (`--network amoy` once `.env` is filled in).
- **Docker Compose:** not for now (team decision, 13 Oct). `npx hardhat node` runs fine on its own and al-core only needs its URL, so Compose would add a container without changing anything. Revisit when the chain is deployed.
- **Audit registry:** the second contract (the write-once SHA-256 audit hash) comes with the audit hash story in Sprint 2, agreed with Nic on 18 Oct, since the Sprint 1 goal covers the loan note only.
- **Keys:** testnet wallets only. Private keys live in `chain/.env`, which git ignores; `chain/.env.example` lists the names with empty values.
