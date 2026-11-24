import { Skeleton, SkeletonTable } from '../../components/Skeleton';
import type { PipelineState } from '../../context/PipelineContext';

interface PipelineStatusProps {
  status: Exclude<PipelineState['status'], 'ready'>;
}

const messages = {
  loading: {
    heading: 'Loading the pipeline',
    detail: 'Fetching the applications in the queue.',
  },
  denied: {
    heading: 'The pipeline is not available',
    detail: 'Your account is not allowed to read applications. Ask an administrator to check your access.',
  },
  error: {
    heading: 'The pipeline could not be loaded',
    detail: 'The connection to the applications failed. Reload the page to try again.',
  },
};

export function PipelineStatus({ status }: PipelineStatusProps) {
  const { heading, detail } = messages[status];

  if (status === 'loading') {
    // The grouping controls, filters and queue table, as they will sit once the applications arrive.
    return (
      <section aria-busy="true" role="status">
        <h2 className="sr-only">{heading}</h2>
        <p className="sr-only">{detail}</p>
        <div aria-hidden="true">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div>
              <Skeleton className="h-3.5 w-16" />
              <div className="mt-2.5 flex gap-1">
                {['w-24', 'w-20', 'w-16'].map((width) => <Skeleton className={`h-11 ${width} rounded-lg`} key={width} />)}
              </div>
            </div>
            {['w-44', 'w-36'].map((width) => (
              <div key={width}>
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className={`mt-2.5 h-11 ${width} rounded-lg`} />
              </div>
            ))}
          </div>
          <div className="mt-6">
            <SkeletonTable columns={8} rows={6} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-8" role="status">
      <h2 className="text-xl font-semibold">{heading}</h2>
      <p className="mt-3 leading-7 text-muted">{detail}</p>
    </section>
  );
}
