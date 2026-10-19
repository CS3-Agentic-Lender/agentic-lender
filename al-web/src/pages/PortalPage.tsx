import { PortalHeader } from '../components/PortalHeader';
import { useAuth } from '../context/AuthContext';
import type { PortalRole } from '../services/authService';

interface PortalPageProps {
  role: PortalRole;
}

export function PortalPage({ role }: PortalPageProps) {
  const { user, authError } = useAuth();
  const heading = role === 'broker' ? 'Broker portal' : 'Underwriter portal';

  return (
    <div className="min-h-screen bg-oat text-ink">
      <PortalHeader />

      <main className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted">
          {role} workspace
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          {heading}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
          You are signed in as {user?.email ?? 'an authenticated user'}. Your trusted Firebase role
          claim permits this placeholder route.
        </p>

        {authError ? (
          <p
            aria-live="polite"
            className="mt-6 max-w-2xl rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error"
          >
            {authError}
          </p>
        ) : null}

        <section className="mt-12 rounded-2xl border border-line bg-tint p-8">
          <h2 className="text-xl font-semibold">Feature placeholder</h2>
          <p className="mt-3 leading-7 text-muted">
            Role-specific functionality will be added through its own reviewed work.
          </p>
        </section>
      </main>
    </div>
  );
}
