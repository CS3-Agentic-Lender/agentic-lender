# Agentic Lender web

Vite, React, TypeScript, React Router, Tailwind CSS, and Firebase Auth foundation for the broker and
underwriter portal.

## Requirements

- Node.js and npm
- Java and the Firebase CLI for local emulator validation

## Install

From the repository root:

```sh
cd al-web
npm ci
```

Use `npm install` only when intentionally changing dependencies and updating `package-lock.json`.

## Development

Start the repository's seeded Firebase emulators from a separate terminal:

```sh
cd al-core
firebase emulators:start --project demo-al --import=./seed-data
```

The development build connects Firebase Auth to `http://127.0.0.1:9099` and Firestore to
`http://127.0.0.1:8080` by default. Copy
`.env.example` to `.env.local` only when a different local URL or Firebase project configuration is
needed. Production builds require all four `VITE_FIREBASE_*` application configuration values and
never connect to the emulator.

Then start the web app:

```sh
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

## Validation

```sh
npm test
npm run build
```

`npm test` runs the Vitest auth, trusted-claim, route-guard, and broker client list tests.
`npm run build` type-checks the project and creates a production bundle in `dist/`.

With the seeded Auth emulator running, verify all three real custom claims without printing tokens:

```sh
AL_EMULATOR_TEST_PASSWORD=<local-seed-password> npm run test:auth-emulator
```

In PowerShell, set the environment variable for the current process before running the npm command.

With the seeded Auth and Firestore emulators running, check that each seeded broker reads only the
applications assigned to them and that the rules refuse anything wider:

```sh
AL_EMULATOR_TEST_PASSWORD=<local-seed-password> npm run test:clients-emulator
```

A broker missing from the seed is reported as `SKIP`, not as a pass.

## Routes

- `/` — redirects to sign in
- `/login` — Firebase email/password sign in
- `/broker` — broker-only placeholder
- `/broker/clients` — the signed-in broker's referred clients and their applications, live
- `/broker/clients/:clientId` — one client's file; any ID outside the broker's own list is "not found"
- `/underwriter` — underwriter-only placeholder
- `/forbidden` — explicit refused-access state
- any other path — not-found page

The portal trusts only the `role` custom claim in the Firebase ID token. Browser storage, URL values,
form fields, and hidden UI are not authorization sources. `getCurrentFirebaseIdToken()` in
`src/services/authService.ts` is the token seam for future authenticated API calls.

The route guard is client-side navigation protection, not an API authorization boundary. Protected
APIs must independently verify the current Firebase ID token and return `401` for invalid or expired
authentication and `403` for insufficient permission. That backend enforcement is not implemented
in this web ticket.

## Broker client list

`src/services/clientsService.ts` holds two live Firestore queries, both filtered to the signed-in
broker's uid: `applications` where `brokerId` matches, and `users` where `brokerId` matches. A client
is a borrower in either result. The Firestore rules are the access boundary: an unfiltered query is
refused, and the client file page only looks inside the broker's own list.

The `users` query follows the draft schema and is refused by the rules currently on `main`. Until
the broker-client assignment rules land, clients are listed by ID with a notice. `loanAmountEur`,
`ltvPct`, `loanType` and `updatedAt` are also draft-schema names; they are read in
`toBrokerApplication` only and show as "—" when a document has none.

The placeholders use the Pine & Oat token set from `src/styles.css` and contain no pipeline, risk,
or lending-decision functionality.
