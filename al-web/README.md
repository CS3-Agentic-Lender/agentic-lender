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

The development build connects Firebase Auth to `http://127.0.0.1:9099` by default. Copy
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

`npm test` runs the Vitest auth, trusted-claim, and route-guard tests. `npm run build` type-checks the
project and creates a production bundle in `dist/`.

With the seeded Auth emulator running, verify all three real custom claims without printing tokens:

```sh
AL_EMULATOR_TEST_PASSWORD=<local-seed-password> npm run test:auth-emulator
```

In PowerShell, set the environment variable for the current process before running the npm command.

## Routes

- `/` — redirects to sign in
- `/login` — Firebase email/password sign in
- `/broker` — broker-only placeholder
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

The placeholders use the Pine & Oat token set from `src/styles.css` and contain no client-list,
pipeline, risk, LTV, or lending-decision functionality.
