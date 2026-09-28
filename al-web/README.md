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

The landing page uses the forest and oat palette being explored in the design prototypes. This is a design proposal; the team palette in `docs/infrastructure.md` remains the shared product source until both frontend owners agree on a change. The portal contains no real borrower data, authentication, or lending decisions.
