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

`npm test` runs the Vitest auth, trusted-claim, route-guard, broker client list, and pipeline queue
tests.
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
- `/underwriter/pipeline` — the underwriter's pipeline queue, live, grouped by LTV band, risk tier or status
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

Applications appear as soon as their query answers, even while profiles are pending. Pending
names show as "Loading name" alongside the client ID, without an unavailable-names notice.
Names update live when profiles arrive; a refused or failed profiles query keeps applications
visible by client ID and shows the notice.

The `users` query follows the draft schema and is refused by the rules currently on `main`. When
that query is refused, clients are listed by ID with a notice. `loanAmountEur`,
`ltvPct`, `loanType` and `updatedAt` are also draft-schema names; they are read in
`toBrokerApplication` through the shared `toApplicationSummary` mapping and show as "—" when a
document has none.

## Underwriter pipeline queue

`src/services/pipelineService.ts` holds two live Firestore listeners: one on the whole `applications`
collection, which the rules on `main` allow for the underwriter role only, and one collection-group
query on `review`. Applications appear as soon as their listener answers; the tier listener never
holds back the queue. The queue groups those applications by LTV band (`<=80%`, `>80% to 90%`, `>90%`, and "No LTV yet"), by risk tier (A to D)
or by lifecycle status, and can be filtered by status. The grouping is in
`src/pages/underwriter/pipelineGroups.ts`. The summary line says whether the group counts are of
all applications or of the filtered ones. The listeners stop when the page is left or the
underwriter signs out.

Field names follow `al-core/SCHEMA.md`, merged on `main`:

- `loanAmountEur`, `ltvPct` and `updatedAt` are read through the same `toApplicationSummary`
  mapping as the client list. The pipeline keeps documents without a `borrowerId`; the broker
  client list still skips them. A document without figures shows "—"; a missing, non-finite or
  negative LTV lands in "No LTV yet".
- The risk tier is read from `applications/{id}/review/underwriting` (field `riskTier`) with a single
  collection-group query on `review`. The rules merged in PR 41 (`match /{path=**}/review/{docId}`)
  let an underwriter read those documents, so the read is allowed for the underwriter role. While
  pending, rows show "Checking" and tier grouping uses "Checking risk tiers", with no notice. If the
  read fails, the cause is shown generically: a permission failure says tiers could not be read for
  this account, any other failure says tiers could not be loaded. Either way every tier shows as
  "Unavailable", the queue still lists applications, and it does not split by tier. Later tier
  results update rows and groups without a reload. A tier is only ever a stored `A`, `B`, `C` or
  `D`; it is never derived from the LTV or mapped from another scale.

The queue treats `ltvPct` as a whole-number percentage (83 means 83%); a fraction such as 0.83 would be banded wrongly, which is an open question for the backend owner.

Status badges share one status-to-tone mapping (`src/utils/statusTone.ts`), used by the queue and the
client list, with the badge colours from `docs/infrastructure.md`: Draft, Applied and Closed are
Neutral; AI Deliberated is Tint; Underwriter Approved and Funded are Success; Declined is Danger. A
status outside the agreed list stays Neutral and is grouped as "Unrecognised status". Every badge
shows the status as text.

The `/broker` and `/underwriter` placeholders use the Pine & Oat token set from `src/styles.css` and
contain no lending-decision functionality.
