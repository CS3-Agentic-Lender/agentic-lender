import { Link, useNavigate } from 'react-router';
import { Mark } from '../components/Mark';
import { useAuth } from '../context/AuthContext';

export function ForbiddenPage() {
  const { role, denialReason, status, action, authError, signOut } = useAuth();
  const navigate = useNavigate();
  const borrower = role === 'borrower';

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      // The provider exposes a safe error while retaining the authenticated state.
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-oat px-6 py-16 text-ink">
      <section className="w-full max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-sm sm:p-12">
        <div className="text-pine">
          <Mark />
        </div>
        <p className="mt-12 font-mono text-xs font-medium uppercase tracking-widest text-error">
          Access refused
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Not allowed</h1>
        <p className="mt-5 leading-7 text-muted">
          {borrower
            ? 'This portal is for brokers and bank staff.'
            : 'Your verified Firebase role does not allow access to this portal area.'}
        </p>
        {denialReason && !borrower ? (
          <p className="mt-3 text-sm text-muted">Ask an administrator to check your role claim.</p>
        ) : null}
        {authError ? (
          <p
            aria-live="polite"
            className="mt-6 rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error"
          >
            {authError}
          </p>
        ) : null}
        {status === 'authenticated' ? (
          <button
            className="mt-8 min-h-11 cursor-pointer rounded-lg bg-pine px-5 py-3 font-semibold text-surface transition-colors hover:bg-pine-pressed disabled:cursor-not-allowed disabled:opacity-60"
            disabled={action === 'signing-out'}
            onClick={() => void handleSignOut()}
            type="button"
          >
            {action === 'signing-out' ? 'Signing out…' : 'Sign out'}
          </button>
        ) : (
          <Link
            className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-pine px-5 py-3 font-semibold text-surface transition-colors hover:bg-pine-pressed"
            to="/login"
          >
            Return to sign in
          </Link>
        )}
      </section>
    </main>
  );
}

