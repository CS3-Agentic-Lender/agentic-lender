import { Link } from 'react-router';
import { Mark } from '../components/Mark';

export function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-oat px-6 py-16 text-ink">
      <section className="w-full max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-sm sm:p-12">
        <div className="text-pine">
          <Mark />
        </div>

        <p className="mt-12 font-mono text-xs font-medium uppercase tracking-widest text-muted">
          Broker and underwriter portal
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Portal access
        </h1>
        <p className="mt-5 max-w-prose text-base leading-7 text-muted">
          This scaffold reserves the sign-in route for the portal. Firebase authentication is not
          implemented here.
        </p>

        <Link
          className="mt-10 inline-flex min-h-11 items-center rounded-lg bg-pine px-5 py-3 font-semibold text-surface transition-colors hover:bg-pine-pressed focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-pine"
          to="/portal"
        >
          View portal foundation
        </Link>
      </section>
    </main>
  );
}
