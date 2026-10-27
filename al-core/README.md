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
| `POST /core/applications/{id}/submit` | Borrower (their own) | No body. Moves a complete Draft to `Applied`, sets `submitted_at` and returns it, which starts the AI review. Needs `applicants`, `gross_income_eur`, `monthly_debts_eur`, `monthly_take_home_eur`, `monthly_living_costs_eur`, `employment_type`, `years_in_current_job`, `loan_amount_eur`, `term_years`, then `deposit_eur` and `first_time_buyer` for a mortgage or `existing_mortgage_balance_eur` for a HELOC, then `property.address_line_1`, `county`, `eircode`, `property_type`, `bedrooms`, `floor_area_sqm`, `ber_rating` (the four the valuation needs) and `asking_price_eur`; `0` and `false` count as answers. A missing one is `422` naming the first (`property.eircode`) and it stays a Draft. Repeating it on an `Applied` application returns it unchanged; any later status is `409`. `404` for someone else's, `403` for staff. After this the borrower can't edit it |
| `GET /core/applications/{id}` | Borrower, broker, underwriter | One application: the borrower's own, a broker's assigned client's, or any for an underwriter. Anything else is `404` |

The `property` object takes `address_line_1`, `address_line_2` (optional, an empty string counts as none), `eircode` (capitals with a space, as on the profile), `county`, `property_type`, `bedrooms`, `floor_area_sqm`, `ber_rating` and `asking_price_eur`, both when creating and when editing a Draft.

An edit and a submit can't overlap: each one writes only if the application hasn't changed since it read it, so an edit can never land on a submitted application. If they do collide, the later one gets `409` and can simply be sent again.

Choosing a broker:

| Endpoint | Who | What |
|---|---|---|
| `GET /core/brokers` | Any signed-in user | Every broker as `uid`, `name` and `firm` (`null` when not set), sorted by name. No contact details |
| `PUT /core/me/broker` | Borrower | Body `{"broker_id": "..."}`. Sets or changes the borrower's broker and returns the profile. `422` naming `broker_id` if that uid isn't a broker, `404` if there is no profile yet. Applications already created keep their original broker |

`GET /core/me` also returns `broker_name` and `broker_firm` for the chosen broker (`null` when none), so the app never reads a broker's profile.

After `POST /core/me` the app must refresh its ID token (`getIdToken(true)`) so the token carries the new `role` claim.

## Example requests

One walkthrough that calls every endpoint in the order the apps use them: sign up, profile, broker, draft, edit, submit, read. Run it from `al-core/` in a bash shell (Git Bash or WSL on Windows) with the emulators and the API running as above. It reads the JSON replies with `uv run python`, since Windows has no `python3` in Git Bash. Use port 8000 instead of 5002 to go through the gateway. Each step prints the response.

```bash
CORE=http://127.0.0.1:5002   # or http://127.0.0.1:8000 through the gateway
AUTH_EMU=http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts

# Sign up / sign in on the Auth emulator and print the ID token (the apps get this from the Firebase SDK)
token() {
  curl -s -X POST "$AUTH_EMU:$1?key=fake-api-key" -H "Content-Type: application/json" \
    -d "{\"email\":\"$2\",\"password\":\"$3\",\"returnSecureToken\":true}" \
    | uv run python -c "import sys, json; print(json.load(sys.stdin)['idToken'])"
}
call() {  # call METHOD PATH [JSON body]
  curl -s -X "$1" "$CORE$2" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" ${3:+-d "$3"}
  echo
}

# 0. Health (no token): {"status": "ok"}
curl -s "$CORE/core/health"; echo

# 1. A new borrower signs up (use a new email each run, or swap signUp for signInWithPassword)
EMAIL="dara-$RANDOM@example.ie"
TOKEN=$(token signUp "$EMAIL" "local-only-pass")

# 2. POST /core/me: create the profile. 201 the first time, 200 after. The email must match the token's
call POST /core/me "{\"full_name\":\"Dara Byrne\",\"email\":\"$EMAIL\",\"phone\":\"+353 87 123 4567\",\"address_line_1\":\"4 Quay Street\",\"county\":\"Cork\",\"eircode\":\"T12 X5R2\"}"

# 3. Sign in again so the token carries the new role claim (the apps call getIdToken(true))
TOKEN=$(token signInWithPassword "$EMAIL" "local-only-pass")

# 4. GET /core/me: the profile, with broker_name and broker_firm (null until a broker is chosen)
call GET /core/me

# 5. GET /core/brokers: uid, name and firm for every broker
call GET /core/brokers

# 6. PUT /core/me/broker: choose Bob (Murphy Mortgages)
call PUT /core/me/broker '{"broker_id":"broker1"}'

# 7. POST /core/applications: start a Draft. Only loan_type is required. 201 with the new id
APP=$(call POST /core/applications '{"loan_type":"mortgage","loan_amount_eur":270000,"term_years":30}' \
  | tee /dev/stderr | uv run python -c "import sys, json; print(json.load(sys.stdin)['id'])")

# 8. PATCH /core/applications/{id}: fill in the rest. Only the fields sent change; property merges field by field
call PATCH "/core/applications/$APP" '{"applicants":"single","gross_income_eur":75000,"monthly_debts_eur":300,"monthly_take_home_eur":4200,"monthly_living_costs_eur":1800,"employment_type":"employed","years_in_current_job":4,"deposit_eur":35000,"first_time_buyer":true,"property":{"address_line_1":"12 Main Street","county":"Cork","eircode":"P31 X2Y3","property_type":"Semi-D","bedrooms":3,"floor_area_sqm":110,"ber_rating":"B2","asking_price_eur":315000}}'

# 9. POST /core/applications/{id}/submit: Draft to Applied (422 names the first missing field)
call POST "/core/applications/$APP/submit"

# 10. GET /core/applications/{id}: as the borrower, then as their broker
call GET "/core/applications/$APP"
TOKEN=$(token signInWithPassword bob@test.com password123)
call GET "/core/applications/$APP"
```

Errors come back as `{"error": {"code", "message", "field", "request_id"}}`, for example a `PATCH` with `"term_years": 41` returns `422` with `"field": "term_years"`. The same calls can be tried from the browser at http://127.0.0.1:5002/core/docs (**Authorize** with the token, then **Try it out**).

End-to-end check against the emulators (API running as above, from `al-core/`):

```
uv run python scripts/smoke_me.py
```

## Blockchain: the loan note and audit registry contracts (`chain/`)

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

`deploy.js` deploys the loan note and the audit registry and saves both addresses to `deployments/localhost.json`, which al-core will read to find the contracts once minting is wired in. `demo-mint.js` mints an example note with made-up references, reads it back and shows that a second mint for the same application is refused. The local chain starts empty each time, so deploy again after restarting the node: `demo-mint.js` says so if the saved address has no contract behind it.

### Choices for the chain

- **Who signs transactions:** al-core, with a server-held testnet wallet (web3.py). The underwriter clicks sign-off in the portal and the API mints, so nobody needs a browser wallet. The wallet's address gets `MINTER_ROLE` at deploy (`MINTER_ADDRESS`, defaulting to the deployer for local work). The notes themselves go to a separate bank address (`HOLDER_ADDRESS`, also defaulting to the deployer), so replacing al-core's wallet never moves them.
- **Libraries:** Hardhat and ethers.js for the contracts, tests and scripts; web3.py in al-core for minting.
- **Where the chain runs:** a local Hardhat node for development. The live site can't reach a node on a laptop, so it will use a public testnet, most likely Polygon Amoy, set up in Sprint 3 (`--network amoy` once `.env` is filled in).
- **Docker Compose:** not for now (team decision, 13 Oct). `npx hardhat node` runs fine on its own and al-core only needs its URL, so Compose would add a container without changing anything. Revisit when the chain is deployed.
- **Audit registry:** the second contract, `contracts/AuditRegistry.sol` (Sprint 2, agreed with Nic on 18 Oct). It stores one SHA-256 hash and the time stored per application reference (the same SHA-256 of the application id the loan note uses), emits `HashStored`, and refuses a second write for the same application, so a stored hash can't change. Only the registrar role, al-core's wallet (the same wallet as the minter), can write, and the admin can hand that role on. Only a hash and the reference go on-chain. Read it with `recordOf(applicationRef)`. How the hash is built is in `SCHEMA.md` and `app/audit.py`.
- **Keys:** testnet wallets only. Private keys live in `chain/.env`, which git ignores; `chain/.env.example` lists the names with empty values.
