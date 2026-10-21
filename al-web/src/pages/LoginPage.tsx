import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Mark } from '../components/Mark';
import { AuthLoadingPage } from '../components/auth/AuthLoadingPage';
import { useAuth } from '../context/AuthContext';
import { getSignInErrorMessage } from '../services/authService';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated') {
      return;
    }

    if (auth.role === 'broker') {
      navigate('/broker', { replace: true });
    } else if (auth.role === 'underwriter') {
      navigate('/underwriter', { replace: true });
    } else {
      navigate('/forbidden', { replace: true });
    }
  }, [auth.status, auth.role, navigate]);

  if (auth.status === 'loading') {
    return <AuthLoadingPage />;
  }

  if (auth.status === 'authenticated') {
    return <AuthLoadingPage />;
  }

  if (auth.status === 'error') {
    return (
      <main className="grid min-h-screen place-items-center bg-oat px-6 py-16 text-ink">
        <section className="w-full max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-sm sm:p-12">
          <div className="text-pine">
            <Mark />
          </div>
          <p className="mt-12 font-mono text-xs font-medium uppercase tracking-widest text-error">
            Authentication error
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            Authentication unavailable
          </h1>
          <p aria-live="assertive" className="mt-5 leading-7 text-muted">
            {auth.authError ?? 'Firebase authentication could not be restored.'}
          </p>
          <p className="mt-3 text-sm text-muted">Reload the page to try again.</p>
        </section>
      </main>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      await auth.signIn(email, password);
    } catch (signInError) {
      setError(getSignInErrorMessage(signInError));
    }
  };

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
          Sign in with your Firebase broker or underwriter account. Access is determined from the
          trusted role claim in your ID token.
        </p>

        <form className="mt-10 grid gap-5" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label className="mb-2 block font-semibold" htmlFor="email">
              Email address
            </label>
            <input
              autoComplete="email"
              className="min-h-12 w-full rounded-lg border border-line bg-surface px-4 text-ink disabled:opacity-60"
              disabled={auth.action === 'signing-in'}
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div>
            <label className="mb-2 block font-semibold" htmlFor="password">
              Password
            </label>
            <input
              autoComplete="current-password"
              className="min-h-12 w-full rounded-lg border border-line bg-surface px-4 text-ink disabled:opacity-60"
              disabled={auth.action === 'signing-in'}
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>

          {error ? (
            <p aria-live="polite" className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error">
              {error}
            </p>
          ) : null}

          <button
            className="min-h-12 cursor-pointer rounded-lg bg-pine px-5 py-3 font-semibold text-surface transition-colors hover:bg-pine-pressed disabled:cursor-not-allowed disabled:opacity-60"
            disabled={auth.action === 'signing-in'}
            type="submit"
          >
            {auth.action === 'signing-in' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
