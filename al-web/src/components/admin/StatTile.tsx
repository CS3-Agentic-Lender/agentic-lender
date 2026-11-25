import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '../Skeleton';

interface StatTileProps {
  label: string;
  // Null when the figure could not be read; the detail says why.
  value: ReactNode | null;
  detail: ReactNode;
  // While the figure loads its value and detail are placeholders, and the detail is read to screen readers only.
  loading?: boolean;
  // The list behind the figure. A tile with somewhere to go is a link.
  to?: string;
}

// One headline figure. The value is text, so nothing rests on a colour.
export function StatTile({ label, value, detail, to, loading = false }: StatTileProps) {
  const body = loading ? (
    <>
      <p className="eyebrow">{label}</p>
      <Skeleton className="mt-3 h-9 w-16" />
      <p className="sr-only">{detail}</p>
      <Skeleton className="mt-1 h-5 w-3/4" />
    </>
  ) : (
    <>
      <p className="eyebrow">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
        {value ?? <span className="text-muted">—</span>}
      </p>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </>
  );

  return to ? (
    <Link
      aria-busy={loading || undefined}
      className="card group block transition-shadow duration-200 hover:shadow-raised"
      to={to}
    >
      {body}
      <span className="sr-only"> Open the list.</span>
    </Link>
  ) : (
    <div aria-busy={loading || undefined} className="card">
      {body}
    </div>
  );
}
