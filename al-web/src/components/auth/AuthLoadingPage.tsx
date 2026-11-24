import { HeaderSkeleton } from '../PageSkeleton';
import { Skeleton, SkeletonCard } from '../Skeleton';

// The portal's frame while the session is restored: a header, a page title and its panels, so the page that
// follows fills in rather than replacing a different screen.
export function AuthLoadingPage() {
  return (
    <div aria-busy="true" className="min-h-screen bg-oat text-ink">
      <HeaderSkeleton />
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="sr-only">Secure portal</p>
        <h1 className="sr-only">Checking portal access</h1>
        <p className="sr-only" role="status">Restoring your session and checking your account access.</p>
        <div aria-hidden="true">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="mt-5 h-9 w-72 max-w-full" />
          <Skeleton className="mt-5 h-4 w-full max-w-xl" />
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </main>
    </div>
  );
}
