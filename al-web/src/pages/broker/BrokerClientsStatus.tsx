import type { BrokerClientsState } from '../../context/BrokerClientsContext';

interface BrokerClientsStatusProps {
  status: Exclude<BrokerClientsState['status'], 'ready'>;
  headingLevel?: 'h1' | 'h2';
}

const messages = {
  loading: {
    heading: 'Loading your clients',
    detail: 'Fetching the client files assigned to you.',
  },
  denied: {
    heading: 'Client files are not available',
    detail: 'Your account is not allowed to read client files. Ask an administrator to check your access.',
  },
  error: {
    heading: 'Client files could not be loaded',
    detail: 'The connection to the client files failed. Reload the page to try again.',
  },
};

export function BrokerClientsStatus({ status, headingLevel: Heading = 'h2' }: BrokerClientsStatusProps) {
  const { heading, detail } = messages[status];

  return (
    <section
      aria-busy={status === 'loading'}
      aria-live="polite"
      className="rounded-2xl border border-line bg-surface p-8"
    >
      <Heading className="text-xl font-semibold">{heading}</Heading>
      <p className="mt-3 leading-7 text-muted">{detail}</p>
    </section>
  );
}
