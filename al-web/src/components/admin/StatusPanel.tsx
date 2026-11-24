import type { ReactNode } from 'react';
import type { LiveState } from '../../hooks/useLive';
import { Skeleton, SkeletonTable } from '../Skeleton';

interface StatusPanelProps {
  tone?: 'error' | 'empty';
  heading: string;
  detail: ReactNode;
  action?: ReactNode;
}

// The one panel for a list that failed or is empty, so every admin list says it the same way.
export function StatusPanel({ tone = 'empty', heading, detail, action }: StatusPanelProps) {
  return (
    <section className="card" role={tone === 'error' ? 'alert' : 'status'}>
      <h2 className={`text-lg font-semibold ${tone === 'error' ? 'text-error' : ''}`}>{heading}</h2>
      <p className="mt-2 leading-7 text-muted">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}

// A panel whose data is still loading: its shape in placeholders, and what is loading for screen readers.
export function LoadingPanel({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section aria-busy="true" className={className}>
      <p className="sr-only" role="status">{label}</p>
      <div aria-hidden="true">{children}</div>
    </section>
  );
}

// An admin list in placeholders: the search box, a filter of `segments` choices, `fields` more filter boxes
// in a row underneath, the "Showing …" line and the table.
export function ListSkeleton({ columns, segments = 0, fields = 0 }: { columns: number; segments?: number; fields?: number }) {
  const field = (key: number) => (
    <div key={key}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-11 rounded-lg" />
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="min-w-0 flex-1 sm:max-w-sm">{field(0)}</div>
        {segments > 0 ? (
          <div>
            <Skeleton className="h-4 w-12" />
            <div className="mt-3 flex flex-wrap gap-1">
              {Array.from({ length: segments }, (_, segment) => (
                <Skeleton className="h-11 w-24 rounded-lg" key={segment} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {fields > 0 ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: fields }, (_, index) => field(index))}
        </div>
      ) : null}
      <Skeleton className="mt-5 h-5 w-44" />
      <div className="mt-4">
        <SkeletonTable columns={columns} rows={6} />
      </div>
    </>
  );
}

// The panel for a live Firestore list that is not ready. `what` names the list, as in "support requests";
// `skeleton` is the list's own shape, shown while it loads.
export function LiveStatus({
  state,
  what,
  skeleton,
}: {
  state: Exclude<LiveState<unknown>, { status: 'ready' }>;
  what: string;
  skeleton: ReactNode;
}) {
  if (state.status === 'loading') {
    return <LoadingPanel label={`Loading the ${what}`}>{skeleton}</LoadingPanel>;
  }

  return (
    <StatusPanel
      detail={
        state.status === 'denied'
          ? `This account is not allowed to read the ${what}. Check that it has the admin role.`
          : `The connection to the ${what} failed. Reload the page to try again.`
      }
      heading={`The ${what} could not be loaded`}
      tone="error"
    />
  );
}
