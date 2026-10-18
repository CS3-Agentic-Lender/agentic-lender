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
| `POST /core/applications` | Borrower | Saves a new Draft. Only `loan_type` is required; the rest of the form is optional until submit. The broker and the borrower's name are copied from their profile. One active application per borrower: if a Draft exists it comes back unchanged with `200`, and an application still in progress gives `409`. `409` too if there is no profile yet or no broker chosen. `422` names the field, with a path for nested ones (`property.county`) |
| `PATCH /core/applications/{id}` | Borrower (their own) | Edits a Draft. Send any of the Draft fields: only those change, `null` clears one, and `property` is merged field by field (`"property": null` clears it all). Changing `loan_type` drops the other type's fields (the deposit and first-time buyer for a HELOC, the existing mortgage balance for a mortgage). `status`, the borrower, broker, name and timestamps are ignored if sent; `updated_at` is set. `409` once it isn't a Draft, `404` for someone else's, `403` for staff. `422` names the field with the same rules as creating, for example `property.eircode` |
| `POST /core/applications/{id}/submit` | Borrower (their own) | No body. Moves a complete Draft to `Applied`, sets `submitted_at` and returns it, which starts the AI review. Needs `applicants`, `gross_income_eur`, `monthly_debts_eur`, `monthly_take_home_eur`, `monthly_living_costs_eur`, `employment_type`, `years_in_current_job`, `loan_amount_eur`, `term_years`, then `deposit_eur` and `first_time_buyer` for a mortgage or `existing_mortgage_balance_eur` for a HELOC, then `property.address_line_1`, `county`, `eircode` and `asking_price_eur`; `0` and `false` count as answers. A missing one is `422` naming the first (`property.eircode`) and it stays a Draft. Repeating it on an `Applied` application returns it unchanged; any later status is `409`. `404` for someone else's, `403` for staff. After this the borrower can't edit it |
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
