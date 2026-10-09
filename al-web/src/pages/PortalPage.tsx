import { useNavigate } from 'react-router';
import { Mark } from '../components/Mark';
import { useAuth } from '../context/AuthContext';
import type { PortalRole } from '../services/authService';

interface PortalPageProps {
  role: PortalRole;
}

export function PortalPage({ role }: PortalPageProps) {
  const { signOut, user, action, authError } = useAuth();
  const navigate = useNavigate();
  const heading = role === 'broker' ? 'Broker portal' : 'Underwriter portal';

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      // The provider exposes a safe error while retaining the authenticated state.
    }
  };

  return (
    <div className="min-h-screen bg-oat text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-20 w-full max-w-5xl items-center justify-between gap-6 px-6">
          <div className="text-pine">
            <Mark />
          </div>
          <button
            className="min-h-11 cursor-pointer rounded-lg border border-pine px-4 py-2 font-semibold text-pine transition-colors hover:bg-tint disabled:cursor-not-allowed disabled:opacity-60"
            disabled={action === 'signing-out'}
            onClick={() => void handleSignOut()}
            type="button"
          >
            {action === 'signing-out' ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
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
