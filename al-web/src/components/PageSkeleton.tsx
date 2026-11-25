import type { ReactNode } from 'react';
import { Skeleton, SkeletonTable } from './Skeleton';

// The portal header in placeholders: the mark, two nav links and the sign-out button.
export function HeaderSkeleton() {
  return (
    <div aria-hidden="true" className="border-b border-line/70 bg-surface/70">
      <div className="mx-auto flex min-h-20 w-full max-w-6xl items-center gap-6 px-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-6 w-20 max-sm:hidden" />
        <Skeleton className="h-6 w-20 max-sm:hidden" />
        <Skeleton className="ml-auto h-10 w-24" />
      </div>
    </div>
  );
}

interface PageSkeletonProps {
  // What is loading, for screen readers.
  label: string;
  // The real header when the caller has it; placeholders otherwise.
  header?: ReactNode;
  // The page body in placeholders; by default a page title over a table.
  children?: ReactNode;
  // The page's own <main> spacing, so its content lands where the placeholders were.
  mainClassName?: string;
}

// A portal page while its code or data loads.
export function PageSkeleton({ label, header, children, mainClassName = 'px-6 py-12' }: PageSkeletonProps) {
  return (
    <div aria-busy="true" className="min-h-screen bg-oat text-ink">
      {header ?? <HeaderSkeleton />}
      <main className={`mx-auto w-full max-w-6xl ${mainClassName}`}>
        <p className="sr-only" role="status">{label}</p>
        {children ?? (
          <div aria-hidden="true">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="mt-5 h-10 w-72 max-w-full" />
            <Skeleton className="mt-5 h-4 w-full max-w-xl" />
            <div className="mt-10">
              <SkeletonTable columns={6} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
