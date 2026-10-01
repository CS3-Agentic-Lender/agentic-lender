# Agentic Lender web

Vite + React + TypeScript + React Router + Tailwind CSS prototype for the broker and underwriter portal.

## Run locally

```powershell
cd al-web
npm install
npm run dev
```

Open the local URL Vite prints (normally `http://localhost:5173`).

Routes:

- `/` — editorial introduction to the product
- `/login` — sign-in placeholder; Firebase Auth is not wired yet
- `/portal` — interactive queue preview with fictional sample applications

`npm run build` checks TypeScript and creates a production bundle. `npm test` runs the queue-filter test.

The placeholder pages use the shared palette A tokens from `docs/infrastructure.md` (navy/action blue, slate text, white surfaces, and IBM Plex Sans/Mono). The token values are defined in `tailwind.config.ts` and exposed to the Vite/Tailwind stylesheet. The portal contains no real borrower data, authentication, or lending decisions.
