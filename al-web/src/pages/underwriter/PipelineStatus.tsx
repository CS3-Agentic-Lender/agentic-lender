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

  return (
    <section className="rounded-2xl border border-line bg-surface p-8" role="status">
      <h2 className="text-xl font-semibold">{heading}</h2>
      <p className="mt-3 leading-7 text-muted">{detail}</p>
    </section>
  );
}
