# al-core: local dev setup

## Prerequisites

- Node.js 22+
- Java (JDK 21+) — required by the Firebase emulators
- `npm install -g firebase-tools`

## Start the emulators

From `al-core/`:

firebase emulators:start --project demo-al --import=./seed-data


Emulator UI: http://127.0.0.1:4000

This setup runs the Firebase Emulator Suite directly via `firebase-tools` — no Docker involved.

## Seeded users

Password for all: `password123`

Roles live in the Firebase Auth custom claim (`role`) set on each user — the `role` field on the `users` Firestore document is just a convenience copy. The backend and rules read the role from the ID token claim, not the document field.

| Email | Role |
|---|---|
| alice@test.com | borrower |
| bob@test.com | broker |
| uma@test.com | underwriter |

## Connect from your dev build

| Platform | Auth | Firestore |
|---|---|---|
| Web | `localhost:9099` | `localhost:8080` |
| iOS Simulator | `localhost:9099` | `localhost:8080` |
| Android Emulator | `10.0.2.2:9099` | `10.0.2.2:8080` |

## Re-seeding

If you change the schema or seed data, regenerate the export:

firebase emulators:start --project demo-al
node scripts/seed.js
firebase emulators:export ./seed-data --project demo-al --force


## Running the rules tests

npm install
npx jest


Requires the emulator (above) running in a separate terminal on port 8080.