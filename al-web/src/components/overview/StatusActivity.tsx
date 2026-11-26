import { Link } from 'react-router';
import { actorPhrase, type ActivityEntry } from '../../pages/shared/overviewFigures';
import { formatDateTime, formatRelative } from '../../utils/formatters';
import { Skeleton } from '../Skeleton';
import { StatusBadge } from '../StatusBadge';

interface StatusActivityProps {
  label: string;
  entries: ActivityEntry[] | 'loading' | 'error';
  hrefFor(applicationId: string): string;
  viewerUid: string | null;
  empty: string;
  now?: Date;
}

// A feed of stored status moves (applications.statusHistory), newest first.
export function StatusActivity({ label, entries, hrefFor, viewerUid, empty, now }: StatusActivityProps) {
  if (entries === 'loading') {
    return (
      <div aria-hidden="true" className="card divide-y divide-line">
        {['w-2/3', 'w-1/2', 'w-3/5', 'w-5/12'].map((width) => (
          <div className="py-4 first:pt-0 last:pb-0" key={width}>
            <Skeleton className={`h-5 ${width}`} />
            <Skeleton className="mt-2 h-4 w-32" />
          </div>
        ))}
      </div>
    );
  }

  if (entries === 'error') {
    return (
      <p className="rounded-lg bg-danger-soft p-3 text-error" role="alert">
        Recent activity could not be loaded. Reload the page to try again.
      </p>
    );
  }

  if (entries.length === 0) {
    return <p className="card text-muted">{empty}</p>;
  }

  // Read at every render, so the times stay current. A move stamped after this clock (a server time a little
  // ahead of the viewer's) reads as "just now", never as the future.
  const reference = now ?? new Date();

  return (
    <ol aria-label={label} className="card divide-y divide-line">
      {entries.map(({ key, applicationId, name, move }) => {
        const actor = actorPhrase(move, viewerUid);

        return (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4 first:pt-0 last:pb-0" key={key}>
            <Link
              className="inline-flex min-h-11 items-center font-medium text-pine underline underline-offset-4 hover:no-underline"
              to={hrefFor(applicationId)}
            >
              {name ? `${name}, ` : ''}
              <span className="font-mono">{applicationId}</span>
            </Link>
            <span className="flex flex-wrap items-center gap-2">
              {move.from ? (
                <>
                  <StatusBadge status={move.from} />
                  <span aria-hidden="true" className="text-muted">→</span>
                  <span className="sr-only">to</span>
                </>
              ) : (
                <span className="text-muted">Moved to</span>
              )}
              <StatusBadge status={move.to} />
            </span>
            <span className="w-full text-muted sm:ml-auto sm:w-auto">
              {actor ? `By ${actor}, ` : ''}
              <time dateTime={move.at.toISOString()} title={formatDateTime(move.at)}>
                {formatRelative(move.at > reference ? reference : move.at, reference)}
              </time>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
