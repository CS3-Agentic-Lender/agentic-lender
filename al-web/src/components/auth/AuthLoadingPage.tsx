export function AuthLoadingPage() {
  return (
    <main
      aria-busy="true"
      className="grid min-h-screen place-items-center bg-oat px-6 text-center text-ink"
    >
      <div>
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted">
          Secure portal
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Checking portal access</h1>
        <p className="mt-4 text-muted">Restoring your Firebase session and verifying its role claim.</p>
      </div>
    </main>
  );
}

