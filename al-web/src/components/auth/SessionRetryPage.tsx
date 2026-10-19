import { useAuth } from '../../context/AuthContext';
import { Mark } from '../Mark';

export function SessionRetryPage() {
  const { retrySession } = useAuth();

  return (
    <main className="grid min-h-screen place-items-center bg-oat px-6 py-16 text-ink">
      <section className="w-full max-w-xl rounded-2xl border border-line bg-surface p-8 shadow-sm sm:p-12">
        <div className="text-pine">
          <Mark />
        </div>
        <h1 className="mt-12 text-4xl font-semibold tracking-tight">Session unavailable</h1>
        <p className="mt-5 leading-7 text-muted" role="alert">
          We could not verify your session, reload to try again
        </p>
        <button
          className="mt-8 min-h-11 cursor-pointer rounded-lg bg-pine px-5 py-3 font-semibold text-surface transition-colors hover:bg-pine-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine"
          onClick={retrySession}
          type="button"
        >
          Retry
        </button>
      </section>
    </main>
  );
}
