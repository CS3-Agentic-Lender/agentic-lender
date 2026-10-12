# Agentic Lender web

Minimal Vite, React, TypeScript, React Router, and Tailwind CSS foundation for the broker and
underwriter portal.

## Requirements

- Node.js and npm

## Install

From the repository root:

```sh
cd al-web
npm ci
```

Use `npm install` only when intentionally changing dependencies and updating `package-lock.json`.

## Development

```sh
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

## Validation

```sh
npm test
npm run build
```

`npm test` runs the Vitest route tests. `npm run build` type-checks the project and creates a
production bundle in `dist/`.

## Routes

- `/` — portal access placeholder
- `/login` — portal access placeholder; Firebase authentication is not implemented here
- `/portal` — empty portal foundation for later broker and underwriter work
- any other path — not-found page

The scaffold uses the Pine & Oat token set defined in `src/styles.css`. It contains no real borrower
data, authentication, pipeline counts, or lending decisions.
