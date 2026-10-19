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

One application in every status, LTV band and risk tier, so each screen and every group in the underwriter's queue has something to show. The field list is in [SCHEMA.md](SCHEMA.md). `node scripts/seed.js --dry-run` prints this table and fails if a status, band or tier goes missing.

| id | Status | LTV band | Tier | Borrower | Broker | Also seeded |
|---|---|---|---|---|---|---|
| `app-draft` | Draft | | | Ben | Ciara | |
| `app-applied` | Applied | | | Alice | Bob | Messages |
| `app-deliberated` | AI Deliberated | over 80 to 90 | C | Alice | Bob | Review, AI run and calls, messages |
| `app-approved` | Underwriter Approved | 80 or less | A | Ben | Ciara | Review, AI run and calls, decision. A HELOC |
| `app-declined` | Declined | over 90 | D | Ben | Ciara | Review, AI run and calls, decision, messages. No audit record |
| `app-funded` | Funded | 80 or less | A | Alice | Bob | Review, AI run and calls, decision, loan note, audit record |
| `app-closed` | Closed | 80 or less | B | Ben | Ciara | Review, AI run and calls, decision, loan note, audit record |

The band and tier only exist once the AI review has run, so Draft and Applied have neither. The seed works the tier out with the agreed rule (SCHEMA.md, risk tier) from what each AI run would have found, rather than typing it in.

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

Requires the emulator (above) running in a separate terminal on port 8080. `test/risk-tier.test.js` (the LTV band and risk tier rules) needs no emulator: `npx jest test/risk-tier.test.js`.

The queue's composite indexes are in `firestore.indexes.json`: status on its own, status with LTV band, and status with risk tier, each newest first by `submittedAt`. The emulator doesn't enforce indexes, so the rules tests check the file has them; the cloud project needs `firebase deploy --only firestore:indexes` once it exists.
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
| `POST /core/applications` | Borrower | Saves a new Draft. Only `loan_type` is required; the rest of the form is optional until submit. The broker and the borrower's name are copied from their profile. One active application per borrower: if a Draft exists it comes back unchanged with `200`, and an application still in progress gives `409`. `409` too if there is no profile yet or no broker chosen. `422` names the field, with a path for nested ones (`property.county`) |
| `PATCH /core/applications/{id}` | Borrower (their own) | Edits a Draft. Send any of the Draft fields: only those change, `null` clears one, and `property` is merged field by field (`"property": null` clears it all). Changing `loan_type` drops the other type's fields (the deposit and first-time buyer for a HELOC, the existing mortgage balance for a mortgage). `status`, the borrower, broker, name and timestamps are ignored if sent; `updated_at` is set. `409` once it isn't a Draft, `404` for someone else's, `403` for staff. `422` names the field with the same rules as creating, for example `property.eircode` |
| `GET /core/applications/{id}` | Borrower, broker, underwriter | One application: the borrower's own, a broker's assigned client's, or any for an underwriter. Anything else is `404` |

The `property` object takes `address_line_1`, `address_line_2` (optional, an empty string counts as none), `eircode` (capitals with a space, as on the profile), `county`, `property_type`, `bedrooms`, `floor_area_sqm`, `ber_rating` and `asking_price_eur`, both when creating and when editing a Draft.

Choosing a broker:

| Endpoint | Who | What |
|---|---|---|
| `GET /core/brokers` | Any signed-in user | Every broker as `uid`, `name` and `firm` (`null` when not set), sorted by name. No contact details |
| `PUT /core/me/broker` | Borrower | Body `{"broker_id": "..."}`. Sets or changes the borrower's broker and returns the profile. `422` naming `broker_id` if that uid isn't a broker, `404` if there is no profile yet. Applications already created keep their original broker |

`GET /core/me` also returns `broker_name` and `broker_firm` for the chosen broker (`null` when none), so the app never reads a broker's profile.

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

**Who holds the notes:** every note is minted to one `holder` address (the bank), fixed when the contract is deployed. It is kept separate from the minter, so if al-core's wallet is replaced, the notes already minted stay with the bank instead of being stranded in the old wallet. The constructor refuses a zero address for the admin, minter or holder.

**Notes can't be transferred.** A note is the bank's record of a loan, not something traded in this app, so the contract only allows minting: any transfer, of an active or a closed note, reverts with `NotTransferable`. A real lender sometimes sells loans on, so a production version might allow active notes to move between approved holders. That is left as future work because nothing in the app needs it.

Run the contract tests (no node or emulator needed):

```
cd chain
npm install
npx hardhat test
```
