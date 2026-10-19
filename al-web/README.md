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
needed. Production builds never connect to the emulator.

A production build needs `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`. If any of them is missing,
`src/services/firebase.ts` throws when the app loads, so the page stays blank and the error is only
in the browser console. Set all four before building for deployment.

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
applications assigned to them and the profiles of the borrowers who chose them, and that the rules
refuse anything wider:

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

The rules on `main` (`al-core/firestore.rules`) let a broker read `users` where `brokerId` is their
own uid, so the `users` query is allowed and names load. If it is refused or fails anyway, clients
are listed by ID with a notice, and a broker with no known application sees that names could not be
loaded rather than "No clients yet". An empty first answer that came only from the local cache is
not treated as a result: the page stays on loading until the server answers. `loanAmountEur`,
`ltvPct`, `loanType` and `updatedAt` are the field names in `al-core/SCHEMA.md`; they are read
through the shared `toApplicationSummary` mapping and show as "—" when a document has none.

## Underwriter pipeline queue

The queue prefers the application document's stored `ltvBand` and `riskTier`, independently.
The stored band uses the asking price; the displayed percentage is labelled "Valuation LTV"
because it uses the valuation and can belong to a different band. Only the exact bands
`80_or_less`, `80_to_90`, `over_90` and tiers `A`, `B`, `C`, `D` are accepted. Invalid values
show "Invalid stored band" or "Invalid stored tier" in their own groups and never use a
fallback. Only absent values (`undefined` or `null`) use the valuation band or review tier.

`src/services/pipelineService.ts` keeps one unfiltered live listener on `applications` and
filters statuses in the browser. The summary counts all applications, and ordering the query
by `submittedAt` would silently drop Draft documents that lack that field. A second listener
on the `review` collection group stays as a fallback because the al-ai work that writes the
application fields is not built yet. Applications appear as soon as their listener answers.
The queue groups them by LTV band (`<=80%`, `>80% to 90%`, `>90%`, and "No LTV yet"), by risk tier (A to D)
or by lifecycle status, and can be filtered by status. The grouping is in
`src/pages/underwriter/pipelineGroups.ts`. The summary line says whether the group counts are of
all applications or of the filtered ones. The listeners stop when the page is left or the
underwriter signs out.

Field names follow `al-core/SCHEMA.md`, merged on `main`:

- `loanAmountEur`, `ltvPct`, `ltvBand`, `riskTier` and `updatedAt` are read through the same `toApplicationSummary`
  mapping as the client list. The pipeline keeps documents without a `borrowerId`; the broker
  client list still skips them. A document without figures shows "—"; a missing, non-finite or
  negative valuation LTV shows a dash. When the stored band is absent, the band falls back to
  `ltvPct`; with neither source it shows "No LTV yet".
- When the stored tier is absent, the tier falls back to `applications/{id}/review/underwriting`.
  A different review tier never overrides a valid stored tier. While the fallback is pending,
  only rows needing it show "Checking" and group under "Checking risk tiers". If it fails,
  those rows show "Unavailable" and group under "Risk tier unavailable". The failure notice
  appears only if at least one application listed after status filtering needs the fallback.
  Stored tiers remain visible and grouped normally throughout. Once the fallback answers,
  a row with neither tier source shows "No tier yet". Live changes to either source update
  rows and group counts without a reload.
- A snapshot that comes from the local cache and is empty is not published as a real empty result,
  for applications or for tiers: the queue stays in its loading state ("Checking" for tiers) until
  the server answers or a listener fails. This stops an unreachable backend from showing "No
  applications yet".

The queue treats `ltvPct` as a whole-number percentage (83 means 83%). The valuation figure
is shown to one decimal, using more decimals at valuation band boundaries (80.04 shows as
"80.04%"). Its label distinguishes it from the stored asking-price band: an application can
be grouped under ">90%" while showing a valuation LTV of 85%.

Status badges share one status-to-tone mapping (`src/utils/statusTone.ts`), used by the queue and the
client list, with the badge colours from `docs/infrastructure.md`: Draft, Applied and Closed are
Neutral; AI Deliberated is Tint; Underwriter Approved and Funded are Success; Declined is Danger. A
status outside the agreed list stays Neutral and is grouped as "Unrecognised status". Every badge
shows the status as text.

The `/broker` and `/underwriter` placeholders use the Pine & Oat token set from `src/styles.css` and
contain no lending-decision functionality.

## Session handling

The portal re-checks the verified ID token's role whenever Firebase reports an ID token change,
including token refreshes. Protected content is hidden while the role is checked; missing or
unrecognised roles are refused. Older checks cannot replace a newer result.

A failed ID-token lookup shows "We could not verify your session, reload to try again" with a Retry
button, rather than a role refusal or administrator advice. Retry reloads the current page through
the same injectable `resetSession` function used for sign-out and role changes. The `error` status
handles token-lookup failures and subscription initialization errors through one shared retry page
on protected routes, sign in and refused access. Missing or invalid roles still show "Not allowed".
The installed SDK documents its listener error callbacks as unused, but its implementation can
invoke them when initialization rejects; ordinary token-change notifications use only the next callback.

A successful sign-out reloads the page at `/login`. If a signed-in user's role changes to another
valid role, the page reloads at its current location so access is checked again. These reloads drop
all in-memory caches, which clearing React state alone cannot do. Initial sign-in, page restoration
and unchanged roles do not trigger a reload. A failed sign-out keeps the session and shows an alert.
