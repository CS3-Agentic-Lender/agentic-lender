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
| alice@test.com | `borrower1` | borrower | Chose broker Bob. Email verified |
| ben@test.com | `borrower2` | borrower | Chose broker Ciara. Email **not** verified, so the iOS app shows its "check your inbox" banner |
| bob@test.com | `broker1` | broker | |
| ciara@test.com | `broker2` | broker | |
| uma@test.com | `underwriter1` | underwriter | |

## Demo accounts on the hosted Firebase project

The seed only ever writes to the emulators (it refuses any project that isn't `demo-`). The hosted project gets its demo accounts from a separate script, `scripts/create-hosted-accounts.js`: the two borrowers, two brokers and the underwriter from the table above, each with its `role` claim and a `users/{uid}` profile. Alice is created with a verified email and Ben without, as in the seed. It does not create applications.

The emails use `@example.com`, not `@test.com`: test.com is a real domain, and the app's "resend verification email" would send mail to whoever owns it. Set `HOSTED_DEMO_EMAIL_DOMAIN` to use a domain the team owns.

Set these in your shell, never in a file in the repo (the key especially: the repo is public):

| Variable | What |
|---|---|
| `FIREBASE_PROJECT_ID` | The hosted project's id. A `demo-` id is refused |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service account key **for that project**, outside this repo (Firebase console, Project settings, Service accounts) |
| `HOSTED_DEMO_PASSWORD` | The password every demo account gets, 12 or more characters. Share it privately |

```
node scripts/create-hosted-accounts.js --dry-run   # shows the accounts, writes nothing
node scripts/create-hosted-accounts.js             # asks you to type the project id, then writes
```

It refuses to run if an emulator host is set, if the key belongs to another project or sits inside this repo, or if the password is short or is the seed's. It never prints the password. Running it again is safe: the accounts get the password and flags again, and a profile that already exists is left alone, so a borrower's choice of broker is kept. Its checks are in `test/hosted-accounts.test.js`; the accounts themselves are defined once, in `scripts/demo-users.js`, which the seed uses too.

### Checking the deployed rules with real sign-ins

`scripts/check-hosted-rules.js` checks that the Firestore rules **deployed** on the hosted project behave as the repo's rules do on the emulator. It signs in as Alice (a borrower), Bob (a broker) and Uma (the underwriter), and also sends requests with no sign-in, through Firestore's REST API, so the rules decide. It tries 96 requests: reads that should be allowed or refused for each person, and writes and deletes, which no client may do (the rules have no `allow write`). Every write and delete is at an id that does not exist (`rules-probe-doc`), so no real data is touched; if a rule ever wrongly allowed a write, the script lists the documents it created so you can delete them in the console. No service account key is needed.

```
node scripts/check-hosted-rules.js --dry-run   # shows what it would check, sends nothing
node scripts/check-hosted-rules.js             # exit code 0 only if every request got the expected answer
```

Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` (the `API_KEY` in `GoogleService-Info.plist`) and `HOSTED_DEMO_PASSWORD` in your shell, as for the accounts script; `HOSTED_DEMO_EMAIL_DOMAIN` is optional. It refuses a `demo-` project and an emulator host, and never prints the password.

The expected answers are in `scripts/hosted-rules-probes.js`. `test/hosted-rules-probes.test.js` replays that same table through the rules engine on the emulator, so the table is checked against `firestore.rules` itself: change a rule, and that test says which expected answer is now wrong. `test/hosted-rules-check.test.js` covers the script (every refusal, how answers are read, what it reports).

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

### The image on AWS

GitHub Actions builds the same `Dockerfile` for `linux/amd64` (what Fargate runs): `docker build --platform linux/amd64 -t al-core .` from `al-core/`. The image tag is the git commit id, which is what `deploy/` expects as `image_tag`.

- **Port:** 5002. **Health check:** `GET /core/health`, `200` with no token. The image also has a Docker `HEALTHCHECK` on it.
- **User:** a system user with no shell, not root.
- **No config or secrets are in the image.** It holds only `app/` and its packages (no `.env`, no `chain/`). Everything comes from environment variables when the container starts:

| Variable | Needed on AWS | What it is |
|---|---|---|
| `FIREBASE_PROJECT_ID` | yes | The hosted Firebase project. Unset, it falls back to `demo-al`, which is the emulator's project |
| `CORS_ALLOWED_ORIGINS` | yes | The portal's origin(s), comma separated, as in "Browser origins (CORS)" below |
| `CHAIN_RPC_URL` | yes | The public testnet's RPC URL. Unset, it is the local Hardhat node |
| `CHAIN_NETWORK` | yes | The network's name, saved on each loan note. Unset, it is `localhost` |
| `LOAN_NOTE_ADDRESS` | yes | The deployed `LoanNote`. Set it: the `chain/deployments/` fallback is not in the image |
| `AUDIT_REGISTRY_ADDRESS` | yes | The deployed `AuditRegistry`. Set it for the same reason |
| `CHAIN_MINTER_PRIVATE_KEY` | yes, secret | Testnet wallet that holds `MINTER_ROLE` |
| `CHAIN_REGISTRAR_PRIVATE_KEY` | yes, secret | Testnet wallet that writes the audit hash |
| `BORROWER_REF_SALT` | yes, secret | Salt for the borrower reference on the loan note. Unset, it is empty and the hash is unsalted, so always set it |
| `STRIPE_SECRET_KEY` | yes, secret | Stripe test key (`sk_test_` or `rk_test_`). Arrives with the fee endpoint |
| `STRIPE_WEBHOOK_SECRET` | yes, secret | The webhook endpoint's signing secret. Arrives with the fee endpoint |

Do **not** set `FIREBASE_AUTH_EMULATOR_HOST` or `FIRESTORE_EMULATOR_HOST` on AWS: with the first set, the Admin SDK accepts emulator-issued tokens, and with the second the API reads and writes an emulator instead of the real database. How the container gets its Firebase service account is still to be agreed (see the ticket).

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
| `POST /core/applications/{id}/submit` | Borrower (their own) | No body. Moves a complete Draft to `Applied`, sets `submitted_at` and returns it, which starts the AI review. Needs `applicants`, `gross_income_eur`, `monthly_debts_eur`, `monthly_take_home_eur`, `monthly_living_costs_eur`, `employment_type`, `years_in_current_job`, `loan_amount_eur`, `term_years` (5 to 35; a Draft saved with another is `422` naming `term_years`), then `deposit_eur` and `first_time_buyer` for a mortgage or `existing_mortgage_balance_eur` for a HELOC, then `property.address_line_1`, `county`, `eircode`, `property_type`, `bedrooms`, `floor_area_sqm`, `ber_rating` (the four the valuation needs) and, for a mortgage only, `asking_price_eur` (a HELOC has no asking price); `0` and `false` count as answers. A missing one is `422` naming the first (`property.eircode`) and it stays a Draft. Repeating it on an `Applied` application returns it unchanged; any later status is `409`. `404` for someone else's, `403` for staff. After this the borrower can't edit it |
| `POST /core/applications/{id}/decision` | Underwriter | Signs off an application that has been through the AI review. Body `{"outcome": "approved" or "declined", "reason": "..."}` (`reason` is optional, up to 1,000 characters). Saves the `decision` (outcome, the underwriter's uid, the time, the reason) and moves the status to `Underwriter Approved` or `Declined` in one write, and logs the move in `statusHistory`. Returns the application with its `decision`. Repeating the same outcome returns it unchanged; the opposite outcome, or any status other than `AI Deliberated`, is `409`. `403` for a broker or borrower, `404` for an unknown id |
| `POST /core/applications/{id}/mint` | Underwriter | No body. Mints the loan note for an `Underwriter Approved` application and moves it to `Funded`. It first anchors the decision's audit hash on the registry, then mints the note (principal in cents, rate in basis points, term in months, loan type, and a salted hash of the borrower's uid, so no personal data goes on chain), then saves `loan_note` (`token_id`, `contract_address`, `tx_hash`, `audit_hash`, `network`, `minted_at`) and the new status in one write (plus `aprPct`, if it was unset and the rate came from the DTI breakdown, so the application shows the rate on its note). `201` with the application the first time; `200` with the same note if it is already `Funded`, so calling it twice never mints twice. Any other status is `409`, as is an application missing its amount, term or rate (`aprPct`, or else the DTI breakdown's benchmark rate) or with no complete AI run to hash. A chain that is down or refuses is `502` with its reason and the application stays `Underwriter Approved`, so the call can be repeated; `503` if the server has no chain settings. `403` for a broker or borrower, `404` for an unknown id |
| `POST /core/applications/{id}/close` | Underwriter | No body. Ends a `Funded` or `Declined` loan and moves it to `Closed`. A `Funded` one has a loan note, so the note is closed on the chain first, then one write saves the new status with the note's `closed_at` (the chain's own time) and `close_tx_hash` inside `loan_note`. A `Declined` one has no note and touches no chain. `200` with the application, whether it was closed now or before: calling it again sends no transaction and returns the same body. Any other status is `409`, as is a `Funded` application with no loan note. A chain that is down or refuses is `502` with its reason and the application stays `Funded`, so the call can be repeated (a close that reached the chain but not Firestore is finished by the retry, never repeated); `503` if the server has no chain settings. `403` for a broker or borrower, `404` for an unknown id |
| `GET /core/applications/{id}/audit-pack` | Underwriter, the assigned broker | Everything an audit pack needs for a decision, from one response, so the PDF, the CSV and the on-chain hash can't disagree: `record` and `audit_hash` (the stored audit record exactly as it is hashed, camelCase and without its own `auditHash`, so hash it as it is and compare), `application` (the summary with its `decision` and `reason`, and the `loan_note` with the mint's `tx_hash`), `audit_tx_hash`, `valuation`, `affordability` and `policy_gate` (the stored maps as they are, `null` if there is no review document), `agent_calls` (each call the record lists with its agent, provider, model, output, time, the hash the record gives it and whether the stored call still hashes to that), and `verification`: the record's hash worked out here, the stored one, the loan note's, the registry's (when this server has a chain; otherwise `on_chain_checked` is false) and `verified`, true only when every hash that could be checked agrees and every call matches. `409` until the loan note is minted. `403` for a borrower, `404` for an unknown id or another broker's application. Read only |
| `POST /core/applications/{id}/messages` | Borrower (their own), the assigned broker, any underwriter | Sends a message on the application's thread. Body `{"text": "..."}`, trimmed, 1 to 2,000 characters (`422` naming `text` otherwise). The sender's id and role come from the token, never the body. Returns `201` with the message (`id`, `application_id`, `sender_id`, `sender_role`, `text`, `sent_at`, `read: false`). `404` for anyone not in the thread, `409` while the application is still a Draft (a broker can't see a Draft, so a thread would have one side). There is no endpoint to edit or delete a message |
| `GET /core/applications/{id}/messages/unread` | The same three | How many messages the caller has not read: `{"unread": n, "last_read_at": "..." or null}`. It counts the messages sent by anyone else after the time the caller last opened the thread (all of theirs if they never have), so each person has their own count: a broker reading the thread does not change an underwriter's. `404` for anyone not in the thread, `409` on a Draft. Read only |
| `POST /core/applications/{id}/messages/read` | The same three | No body. Also records the caller's own last-read time, the send time of the newest message when they opened the thread (nothing is written again if nothing is new), together with the flags or not at all, so `GET .../messages/unread` gives `0` afterwards. Marks the unread messages sent *to the caller's side* as read and returns `{"marked": n}`: the borrower clears what the broker and the underwriters sent, and a broker or an underwriter clears what the borrower sent. So a broker opening the thread never clears an underwriter's message to the borrower, and the borrower's unread count stays right. The `read` flag of a message between the broker and an underwriter is left alone: use `GET .../messages/unread` for a per-person count, which does count it for the one it was sent to. The messages are updated together, all or none. Safe to repeat. The apps read the messages straight from Firestore (`applications/{id}/messages`); this is the only way to change `read` |
| `POST /core/saved-checks` | Borrower | Keeps a property check the borrower ran. Send `property` (`county`, `eircode`, `property_type`, `bedrooms`, `floor_area_sqm`, `ber_rating` and an optional `asking_price_eur`, the application's names and limits) plus the result you already have: `estimated_value_eur`, `asking_price_gap`, `price_needs_review`, `support_warnings` and `model_version`. al-core validates and stores it and does not call al-ai again. `201` with the saved check and its `id`. The gap and the flag must be null or left out when there is no asking price. At most 20 per borrower: the 21st is `409`. `422` names the field (`property.eircode`) |
| `POST /core/support-requests` | Borrower | Sends a support request. Send `category` (`application`, `payment`, `account` or `other`), `subject` (1 to 100 characters) and `message` (1 to 2000), all required, and optionally `application_id`, one of the borrower's own applications (someone else's or an unknown id is `404`). `201` with `reference` (for example `SR-7KQ2M9XD`, unique, also the document id), the fields, `application_id` (null if none), `status` (`open`) and `created_at`. The borrower's id comes from the token. The borrower reads their own requests from Firestore, underwriters read all. `422` names the field |
| `POST /core/applications/{id}/fee-intent` | Borrower (their own) | Starts the EUR 150 fast-track fee for an application that is Applied or AI Deliberated. No body. `200` with `client_secret` (for the payment sheet), `payment_intent_id` and `amount_eur` (150). Saves `feeIntentId` and `feeStatus: "unpaid"` on the application. Asking again returns the same intent. `409` for a Draft, a decided application, or one already paid; `404` for someone else's; `502` if Stripe cannot be reached; `503` if the Stripe settings are missing. Test keys only |
| `POST /core/webhooks/stripe` | Stripe (no Firebase token) | The only thing that marks the fee paid. Believed only when Stripe's signature on the raw body is valid (`400` otherwise). On `payment_intent.succeeded` for the saved intent, EUR 150, it sets `feeStatus: "paid"`, `feePaidAt` and `fastTrack: true` in one write. Anything else is acknowledged with `200` and changes nothing. See "The fast-track fee" below |
| `DELETE /core/saved-checks/{id}` | Borrower (their own) | Removes a saved check: `204`, and `404` for someone else's or an unknown id. There is no list endpoint: read `users/{uid}/saved_checks` from Firestore |
| `PUT /core/reviews/me` | Borrower | Saves the borrower's one review of the app, replacing the one they had. Send `rating` (a whole number, 1 to 5) and an optional `comment` (up to 500 characters; blank means none). `200` with `rating`, `comment`, `created_at` (the first save, kept on replacement) and `updated_at`. The borrower's id comes from the token, so nobody can write another borrower's review. The borrower reads their own from Firestore at `reviews/{uid}`, underwriters read all. `422` names the field |
| `GET /core/applications/{id}` | Borrower, broker, underwriter | One application: the borrower's own, a broker's assigned client's, or any for an underwriter. Anything else is `404`. It includes `ltv_band` (`80_or_less`, `80_to_90` or `over_90`) and `risk_tier` (`A` to `D`), which are `null` until al-ai sets them after a run. `POST` and `PATCH` ignore them if sent |

The `property` object takes `address_line_1`, `address_line_2` (optional, an empty string counts as none), `eircode` (capitals with a space, as on the profile), `county`, `property_type`, `bedrooms`, `floor_area_sqm`, `ber_rating` and `asking_price_eur`, both when creating and when editing a Draft. `asking_price_eur` only applies to a mortgage: on a HELOC it is `422` (`property.asking_price_eur`), and changing a Draft to a HELOC drops it, like the deposit.

An edit and a submit can't overlap: each one writes only if the application hasn't changed since it read it, so an edit can never land on a submitted application. If they do collide, the later one gets `409` and can simply be sent again.

Choosing a broker:

| Endpoint | Who | What |
|---|---|---|
| `GET /core/brokers` | Any signed-in user | Every broker as `uid`, `name` and `firm` (`null` when not set), sorted by name. No contact details |
| `PUT /core/me/broker` | Borrower | Body `{"broker_id": "..."}`. Sets or changes the borrower's broker and returns the profile. `422` naming `broker_id` if that uid isn't a broker, `404` if there is no profile yet. Applications already created keep their original broker |

`GET /core/me` also returns `broker_name` and `broker_firm` for the chosen broker (`null` when none), so the app never reads a broker's profile.

After `POST /core/me` the app must refresh its ID token (`getIdToken(true)`) so the token carries the new `role` claim.

## Example requests

One walkthrough that calls every endpoint in the order the apps use them: sign up, profile, broker, draft, edit, submit, read, sign-off, messages. Run it from `al-core/` in a bash shell (Git Bash or WSL on Windows) with the emulators and the API running as above. It reads the JSON replies with `uv run python`, since Windows has no `python3` in Git Bash. Use port 8000 instead of 5002 to go through the gateway. Each step prints the response.

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

# 11. POST /core/saved-checks: keep a property check (as the borrower). 201 with its id. 20 at most, the 21st is 409
TOKEN=$(token signInWithPassword "$EMAIL" "local-only-pass")
CHECK=$(call POST /core/saved-checks '{"property":{"county":"Cork","eircode":"T12 X8Y2","property_type":"Semi-D","bedrooms":3,"floor_area_sqm":110,"ber_rating":"B2","asking_price_eur":379000},"estimated_value_eur":371800,"asking_price_gap":0.0194,"price_needs_review":false,"support_warnings":[],"model_version":"v2"}'   | tee /dev/stderr | uv run python -c "import sys, json; print(json.load(sys.stdin)['id'])")

# 12. DELETE /core/saved-checks/{id}: remove it. 204, then 404 on a second try
call DELETE "/core/saved-checks/$CHECK"

# 13. POST /core/applications/{id}/decision: an underwriter signs off a seeded application that is AI Deliberated.
#     200 with the decision, 409 for the opposite outcome (re-import seed-data/ to reset it)
TOKEN=$(token signInWithPassword uma@test.com password123)
call POST "/core/applications/app-deliberated/decision" '{"outcome":"approved","reason":"Low LTV and DTI within limits"}'

# 14. POST /core/applications/{id}/messages: the borrower, then their broker, send a message on the submitted application (201 each)
TOKEN=$(token signInWithPassword "$EMAIL" "local-only-pass")
call POST "/core/applications/$APP/messages" '{"text":"I have uploaded my payslips."}'
TOKEN=$(token signInWithPassword bob@test.com password123)
call POST "/core/applications/$APP/messages" '{"text":"Thanks Dara, I have them."}'

# 15. POST /core/applications/{id}/messages/read: Bob marks the borrower's message as read ({"marked": 1}; his own message is not his to mark); again gives {"marked": 0}
call POST "/core/applications/$APP/messages/read"
call POST "/core/applications/$APP/messages/read"

# 15b. GET /core/applications/{id}/messages/unread: Bob's own unread count is now 0 ({"unread": 0, "last_read_at": ...}); the
#      underwriter, who has not opened the thread, still has hers
call GET "/core/applications/$APP/messages/unread"

# 16. POST /core/applications/{id}/mint: an underwriter mints the loan note for a seeded Underwriter Approved application.
#     Needs the local chain (see "The loan note and the mint" below). 201 the first time and the status becomes Funded;
#     the same call again is 200 with the same note (re-import seed-data/ to reset it)
TOKEN=$(token signInWithPassword uma@test.com password123)
call POST "/core/applications/app-approved/mint"
call POST "/core/applications/app-approved/mint"

# 17. GET /core/applications/{id}/audit-pack: the audit pack for a Funded application (the one just minted, or the seeded app-funded).
#     200 with the record, its hash, the documents behind it and a verification block; 409 before the loan note exists
call GET "/core/applications/app-funded/audit-pack"

# 18. POST /core/applications/{id}/close: the underwriter closes the loan that was just minted. Needs the local chain.
#     200 with status Closed and loan_note.closed_at / close_tx_hash; the same call again is 200 with the same body and
#     sends no transaction. A seeded Declined application (app-declined) closes with no chain at all; a seeded app-funded
#     has a made-up note that is not on your local chain, so closing it is 502
call POST "/core/applications/app-approved/close"
call POST "/core/applications/app-approved/close"
call POST "/core/applications/app-declined/close"

# 19. POST /core/support-requests: a borrower sends a support request. 201 with its reference number (SR- and 8 characters).
#     category is application, payment, account or other; subject is 1 to 100 characters, message 1 to 2000
TOKEN=$(token signInWithPassword "$EMAIL" "local-only-pass")
call POST /core/support-requests '{"category":"payment","subject":"My fee did not go through","message":"I paid the EUR 150 fee twice."}'
call POST /core/support-requests "{\"category\":\"application\",\"subject\":\"Question about my application\",\"message\":\"When will a broker look at it?\",\"application_id\":\"$APP\"}"

# 20. PUT /core/reviews/me: a borrower rates the app. 200 with the review; the same call again replaces it.
#     rating is 1 to 5, comment is optional (up to 500 characters)
TOKEN=$(token signInWithPassword "$EMAIL" "local-only-pass")
call PUT /core/reviews/me '{"rating":4,"comment":"Clear and quick."}'
call PUT /core/reviews/me '{"rating":5}'
```

Errors come back as `{"error": {"code", "message", "field", "request_id"}}`, for example a `PATCH` with `"term_years": 41` (the loan term is 5 to 35 years) returns `422` with `"field": "term_years"`. The same calls can be tried from the browser at http://127.0.0.1:5002/core/docs (**Authorize** with the token, then **Try it out**).

End-to-end check against the emulators (API running as above, from `al-core/`):

```
uv run python scripts/smoke_me.py
```

The close endpoint has its own end-to-end check against the emulators **and** a local chain (see "The loan note and the mint" below for starting the node and the chain settings). It mints the seeded `app-approved`, closes it, checks Firestore and the contract agree, and closes the seeded Declined application; 16 checks. It changes the emulator and the node, so to run it again re-import `seed-data/` and redeploy:

```
uv run python scripts/smoke_close.py
```

## The fast-track fee (Stripe test mode)

A borrower with a submitted application can pay EUR 150 to be flagged fast-track. The app calls `POST /core/applications/{id}/fee-intent`, shows Stripe's payment sheet with the `client_secret`, and then waits for `feeStatus` on the application (read from Firestore) to become `paid`. Only Stripe's webhook sets it, together with `feePaidAt` and `fastTrack`.

Test keys only: the server refuses a key that is not `sk_test_…` or `rk_test_…`. The API reads `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from its **environment**: it does not load a `.env` file, so set them in the shell that starts the API (never commit the values). In PowerShell, the prompts below keep the secrets out of your command history:

```powershell
$k = Read-Host "Stripe secret key (sk_test_...)" -AsSecureString
$env:STRIPE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($k))
$w = Read-Host "Webhook signing secret (whsec_...)" -AsSecureString
$env:STRIPE_WEBHOOK_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($w))
```

In bash or zsh (macOS and Linux), the same, with the typing hidden:

```bash
printf "Stripe secret key (sk_test_...): "; read -rs STRIPE_SECRET_KEY; echo; export STRIPE_SECRET_KEY
printf "Webhook signing secret (whsec_...): "; read -rs STRIPE_WEBHOOK_SECRET; echo; export STRIPE_WEBHOOK_SECRET
```

**On the Docker stack** (`docker compose up -d --build` from the repo root, with the emulators running), the `al-core` container gets both settings from the shell you start it in, or from a `.env` file next to `docker-compose.yml` (Compose reads it on its own; it is gitignored). Set them first, with the lines above, then start the stack in the same shell; without them the fee endpoint answers 503. Nothing is baked into the image. The API is on `localhost:5002` (and behind the gateway on `localhost:8000`), so `stripe listen` forwards to `localhost:5002/core/webhooks/stripe` as below. After changing a setting, run `docker compose up -d al-core` again so the container picks it up.

To try it locally, with the emulators and the API running (see "Running the API"):

```bash
stripe login                                              # once, with the team's Stripe sandbox
stripe listen --events payment_intent.succeeded,payment_intent.payment_failed --forward-to localhost:5002/core/webhooks/stripe
# it prints "Your webhook signing secret is whsec_...": that is STRIPE_WEBHOOK_SECRET, then start the API
```

Current versions of the Stripe CLI refuse `stripe listen` without `--events`. Then call `fee-intent` as a borrower (for example Alice, for the seeded Applied application `app-applied`) and pay the intent with Stripe's test card `4242 4242 4242 4242`: `stripe payment_intents confirm <payment_intent_id> --payment-method pm_card_visa`. The CLI forwards the success event and the application becomes `paid` and fast-track. `pm_card_chargeDeclined` is the declined card: the CLI exits 0 and prints the Stripe error (`card_declined`) as JSON, the fee stays `unpaid` and the same intent can be paid again with a good card. After an intent is cancelled (`stripe payment_intents cancel <id>`), asking for the fee again makes a new intent, because the idempotency key names the cancelled one, so Stripe does not hand the cancelled one back.

`stripe trigger payment_intent.succeeded` does not work on a current sandbox (Stripe's fixture uses a parameter Stripe has removed). To check that a payment that is not our fee is ignored, make one by hand: `stripe payment_intents create --amount 2000 --currency eur -d "automatic_payment_methods[enabled]=true" -d "automatic_payment_methods[allow_redirects]=never"`, then confirm it with `pm_card_visa`. The webhook answers 200 and no application changes.

**The team shares one Stripe sandbox.** Every developer's emulator has the same seeded applications (`app-applied`, `app-deliberated`), and Stripe replays the answer to a repeated idempotency key for 24 hours, so the key names its environment: `al-fee-{namespace}-{application id}-{first, or the cancelled intent it replaces}`. On the hosted Firebase project the namespace is its project id (the same on every task, so a double click that reaches two tasks still makes one intent). On the emulators (a `demo-` project) it is a random value picked when the API process starts, so two developers are never handed each other's intents, and nobody has to choose a fresh application id. `STRIPE_KEY_NAMESPACE` overrides it. If Stripe still hands back a new intent that is already paid or cancelled, `fee-intent` refuses it (409 and 502) and saves nothing.

**The payment sheet offers cards only, and that is a dashboard setting, not code.** The intents use automatic payment methods, which follow what is switched on under Settings, Payments, Payment methods in the Stripe dashboard (this sandbox refuses the `payment_method_types` parameter). Link, MB WAY, Revolut Pay and Satispay are switched off there on the team's sandbox: a new intent reports `["card"]`. If the sandbox is ever recreated, or a method is switched back on, the sheet will offer it again.

**Run for real on 18 November 2026** against the team's Stripe sandbox, with the emulators, the API and `stripe listen`: the fee intent (EUR 150, the same intent when asked again), the test card (application `paid`, `fastTrack` true, `feePaidAt` set, status unchanged), a second request for a paid application (409), a cancelled intent replaced by a new one, a declined card (fee stays unpaid), a good card on the same intent afterwards (paid), a bad and a missing signature (400 each), and a real EUR 20 payment that is not the fee (ignored).

## Browser origins (CORS)

Only the portal's origin may call al-core from a browser (API design doc, section 5). The allowed origins come from the `CORS_ALLOWED_ORIGINS` setting, comma separated, the same name al-ai uses (`app/cors.py`):

- **Not set:** only `http://localhost:5173`, the local portal.
- **Sprint 3:** set it to the deployed portal's origin, for example `https://portal.example.ie`, with no code change.
- **Refused:** `*`, and anything that is not an origin (a path, a query or no scheme), so al-core won't start with a bad value.
- **Behaviour:** a browser preflight (`OPTIONS`) from an allowed origin with an `Authorization` header gets `200`. Another origin gets no `access-control-allow-origin`, so the browser blocks the call. Cookies are not allowed (tokens travel in the header). A request with no `Origin` header, such as the iOS app or another service, is not affected.

An unhandled `500` is built outside the CORS middleware, so it carries no `access-control-allow-origin` even for the portal. The browser then shows a CORS error instead of the `500`: when a portal call fails that way, check the al-core log for the real error.

The gateway forwards every method, `OPTIONS` included, so al-core answers the preflight itself and the gateway needs no change. The local compose file passes no CORS setting, so the default (the local portal) applies. To add another origin locally, set `CORS_ALLOWED_ORIGINS` in the `al-core` service's `environment`.

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

`deploy.js` deploys the loan note and the audit registry and saves both addresses to `deployments/localhost.json`, which al-core reads to find the contracts (see "The loan note and the mint" below). `demo-mint.js` mints an example note with made-up references, reads it back and shows that a second mint for the same application is refused. The local chain starts empty each time, so deploy again after restarting the node: `demo-mint.js` says so if the saved address has no contract behind it.

### The audit record and its hash (`app/audit.py`, `app/audit_store.py`, `app/chain.py`)

When an application is signed off and approved, al-core builds one **audit record** from what is stored, hashes it, saves it at `applications/{id}/audit/record` and writes the hash to the registry. A declined application has none. `audit_store.anchor(application_id, registry)` does all of it and is safe to call again; the mint endpoint calls it.

**The record** has exactly these ten fields. Keys are sorted, so this order is the order they are hashed in:

| Field | Value |
|---|---|
| `aiCalls` | one `{"id", "sha256"}` per logged call of the run, oldest first (ties by id). `sha256` is the hash of that `ai_calls` document, in the same way as the record's (the document with its times as UTC strings). The valuation agent's call is in here, so the valuation data is covered by its hash |
| `applicationId` | the application id |
| `creditMemo` | the run's credit memo, as text |
| `decision` | `approved` |
| `loanType` | `mortgage` or `heloc`, as stored on the application |
| `principalCents` | the loan amount in euro cents, a whole number: `loanAmountEur` times 100, a half rounded up (`123456.78` euro is `12345678`) |
| `riskTier` | `A`, `B`, `C` or `D` |
| `signedOffAt` | the sign-off time as UTC with milliseconds and a Z, for example `2026-09-18T11:00:00.000Z` |
| `termMonths` | the term in months, a whole number: `termYears` times 12 |
| `underwriterId` | the underwriter's uid |

Which run: the latest **complete** run of the application. `principalCents` and `termMonths` are the only numbers in the record, and they are whole numbers, written without a decimal point or an exponent (`29000000`, never `29000000.0`), so Python and JavaScript hash the same bytes. Every other field is text. They come from the same functions as the loan note's terms (`app/loan_terms.py`), so what the hash proves and what was minted can't disagree; an application with no loan amount, no whole-year term or no loan type can't make a record. The rate is not in the record: it isn't priced yet and may change when pricing arrives, and the loan note already carries it on the chain. There is no version field. After this change, re-import `seed-data/` to reset a dev emulator that still holds a record made before it: a saved record is never replaced by one with another hash.

**The hash** is the SHA-256, in lower-case hex, of `json.dumps(record, sort_keys=True, separators=(",", ":"))` encoded as UTF-8, with the record's own `auditHash` field left out. Non-ASCII text is escaped by `json.dumps` (an accented e is written as backslash, u, 0, 0, e, 9), so the text hashed is pure ASCII. To check a loan by hand, take `record` from the audit pack, remove `auditHash`, and run:

```python
import hashlib, json
record.pop("auditHash", None)
print(hashlib.sha256(json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest())
```

and compare it with the `auditHash` and with the value in the registry. The shared examples (the seeded records and a non-ASCII one) are in `test/audit-hash-vectors.json`, and al-ai's tests load the same file.

**On the chain:** the registry holds one hash per application. It is keyed by the SHA-256 of the application id (`audit.application_ref`, the same reference the loan note uses), so no personal data is stored. A second write for the same application is refused by the contract; `chain.AuditRegistry.store` treats the same hash again as already done (no transaction) and a different hash as an error. The transaction hash is saved on the application as `auditTxHash`. If the process stops after the registry write and before that save, the next `anchor` finds the hash already stored, reads the transaction back from the registry's `HashStored` event (`AuditRegistry.tx_of`) and saves it. An application that already has an `auditTxHash` is never changed, and if the event can't be found the anchor still succeeds, leaves the field empty and logs the reason.

**Settings** (names are in `.env.example`; keys live in `.env`, never in the repo, testnet wallets only):

| Setting | Meaning |
|---|---|
| `CHAIN_RPC_URL` | the node, default `http://127.0.0.1:8545` (the local Hardhat node) |
| `CHAIN_REGISTRAR_PRIVATE_KEY` | the registrar wallet's key. Locally, account #0's key as `npx hardhat node` prints it |
| `AUDIT_REGISTRY_ADDRESS` | the deployed registry; if unset, `chain/deployments/<CHAIN_NETWORK>.json` is used (`CHAIN_NETWORK` defaults to `localhost`) |

**Checking it against a real chain:** with the node and `npm run deploy:local` running as above, `CHAIN_LIVE_TEST=1 CHAIN_REGISTRAR_PRIVATE_KEY=<account #0's key> uv run pytest tests/test_chain_live.py`. Without those, that test is skipped and CI uses stand-ins for web3.

### The loan note and the mint (`app/mint.py`, `app/loan_notes.py`)

`POST /core/applications/{id}/mint` (underwriters only) is the step after sign-off. In order:

1. Read the application. A `Funded` one with a note is answered as it is (`200`); anything but `Underwriter Approved` is `409`. The note's terms are worked out before the chain is touched: principal in euro cents from `loanAmountEur`, the rate in basis points from `aprPct` (or, until pricing exists, the DTI breakdown's benchmark rate), the term in months from `termYears`, the loan type, and the borrower reference. Anything missing or out of the contract's range (a term over 40 years, a rate over 100%) is `409` and nothing is sent.
2. `audit_store.anchor` saves the audit record and writes its hash to the registry.
3. `LoanNotes.mint` mints the note. If a note for the application is already on the chain (a mint that reached the chain but never reached Firestore, or a second request that lost the race), it finds that note and its transaction instead of minting again, and refuses if its terms differ.
4. One guarded write saves `loanNote` and moves the status to `Funded` (the log entry is `actor: mint`, with the underwriter's uid as `actorId`). If `aprPct` was unset, the same write saves the rate that went on the note as `aprPct`, because the borrower can't read the DTI breakdown the rate came from. If the application changed while the chain was working, the write is `409` and calling again finishes the job from step 3.

A chain failure at step 2 or 3 is `502`, the status stays `Underwriter Approved`, and the same call can be repeated.

`POST /core/applications/{id}/close` (`app/close.py`) is the step that ends a loan. A `Declined` application is moved to `Closed` with no chain call. A `Funded` one is closed on the chain first (`LoanNotes.close`, the contract's `close(tokenId)`), then one guarded write saves `loanNote.closedAt`, `loanNote.closeTxHash` and the status `Closed` (the log entry is `actor: underwriter`). The contract closes a note once and never reopens it, so a close that reached the chain but not Firestore is picked up by the retry: the note is found already closed, its closing transaction is read back from the `NoteClosed` event, and nothing is sent again. `closedAt` is the chain's own time for the close, so a retry saves the same value.

The borrower reference is `sha256(BORROWER_REF_SALT + uid)`, so the uid can't be read back from the note; the salt stays in al-core. The application reference is the same SHA-256 of the application id that the audit registry uses.

| Setting | Meaning |
|---|---|
| `CHAIN_MINTER_PRIVATE_KEY` | the wallet that holds the contract's `MINTER_ROLE`. Locally, account #0's key as `npx hardhat node` prints it |
| `LOAN_NOTE_ADDRESS` | the deployed `LoanNote`; if unset, `chain/deployments/<CHAIN_NETWORK>.json` is used |
| `BORROWER_REF_SALT` | the secret mixed into the borrower reference. Any long random text; changing it changes every reference minted after |
| `CHAIN_RPC_URL` | as for the audit registry above |
| `CHAIN_NETWORK` | the chain's name, `localhost` when unset or empty. It picks `chain/deployments/<name>.json` when `LOAN_NOTE_ADDRESS` is not set, and it is saved on the note as `loanNote.network` |

With a local node and `npm run deploy:local` running, the live checks are `CHAIN_LIVE_TEST=1 CHAIN_MINTER_PRIVATE_KEY=<account #0's key> CHAIN_REGISTRAR_PRIVATE_KEY=<account #0's key> uv run pytest tests/test_chain_live.py` (add `CHAIN_LIVE_STRANGER_KEY=<account #1's key>` to also check that a wallet without the role is refused).

### Choices for the chain

- **Who signs transactions:** al-core, with a server-held testnet wallet (web3.py). The underwriter clicks sign-off in the portal and the API mints, so nobody needs a browser wallet. The wallet's address gets `MINTER_ROLE` at deploy (`MINTER_ADDRESS`, defaulting to the deployer for local work). The notes themselves go to a separate bank address (`HOLDER_ADDRESS`, also defaulting to the deployer), so replacing al-core's wallet never moves them.
- **Libraries:** Hardhat and ethers.js for the contracts, tests and scripts; web3.py in al-core for minting.
- **Where the chain runs:** a local Hardhat node for development. The live site can't reach a node on a laptop, so it will use a public testnet, most likely Polygon Amoy, set up in Sprint 3 (`--network amoy` once `.env` is filled in).
- **Docker Compose:** not for now (team decision, 13 Oct). `npx hardhat node` runs fine on its own and al-core only needs its URL, so Compose would add a container without changing anything. Revisit when the chain is deployed.
- **Audit registry:** the second contract, `contracts/AuditRegistry.sol` (Sprint 2, agreed with Nic on 18 Oct). It stores one SHA-256 hash and the time stored per application reference (the same SHA-256 of the application id the loan note uses), emits `HashStored`, and refuses a second write for the same application, so a stored hash can't change. Only the registrar role, al-core's wallet (the same wallet as the minter), can write, and the admin can hand that role on. Only a hash and the reference go on-chain. Read it with `recordOf(applicationRef)`. How the hash is built is in `SCHEMA.md` and `app/audit.py`.
- **Keys:** testnet wallets only. Private keys live in `chain/.env`, which git ignores; `chain/.env.example` lists the names with empty values.
