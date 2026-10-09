import { Link } from 'react-router';
import { Mark } from '../components/Mark';

export function PortalPage() {
  return (
    <div className="min-h-screen bg-oat text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-20 w-full max-w-5xl items-center justify-between gap-6 px-6">
          <div className="text-pine">
            <Mark />
          </div>
          <Link className="font-semibold text-pine underline-offset-4 hover:underline" to="/login">
            Portal access
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted">
          React portal scaffold
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          Portal foundation
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
          Routing and shared visual tokens are ready for later broker and underwriter features. No
          client records, pipeline counts, or lending decisions are represented in this scaffold.
        </p>

        <section className="mt-12 rounded-2xl border border-line bg-tint p-8">
          <h2 className="text-xl font-semibold">Feature placeholder</h2>
          <p className="mt-3 leading-7 text-muted">
            Portal functionality will be added through its own reviewed work.
          </p>
        </section>
      </main>
    </div>
  );
}
