import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-oat px-6 text-center text-ink">
      <div>
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted">404</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-4 text-muted">The requested scaffold route does not exist.</p>
        <Link
          className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-pine px-5 py-3 font-semibold text-surface hover:bg-pine-pressed"
          to="/"
        >
          Return to portal access
        </Link>
      </div>
    </main>
  );
}
