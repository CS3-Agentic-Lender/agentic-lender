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

Run the contract tests (no node or emulator needed):

```
cd chain
npm install
npx hardhat test
```
