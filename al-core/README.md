# al-core: local dev setup

## Prerequisites

- Node.js 22+
- Java (JDK 21+) — required by the Firebase emulators
- `npm install -g firebase-tools`

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