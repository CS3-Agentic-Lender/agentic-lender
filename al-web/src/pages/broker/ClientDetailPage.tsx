import { Link, useParams } from 'react-router';
import { PortalHeader } from '../../components/PortalHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useBrokerClients } from '../../context/BrokerClientsContext';
import { formatDate, formatEuro, formatPercent } from '../../utils/formatters';
import { BrokerClientsStatus } from './BrokerClientsStatus';

const backLinkClass = 'font-medium text-pine underline-offset-4 hover:underline';

export function ClientDetailPage() {
  const { clientId } = useParams();
  const state = useBrokerClients();
  // Looked up in the broker's own live list only, so another broker's client and a client that
  // does not exist are the same answer and no extra read is made.
  const client = state.status === 'ready' ? state.clients.find(({ id }) => id === clientId) : undefined;

  return (
    <div className="min-h-screen bg-oat text-ink">
      <PortalHeader />

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <Link className={backLinkClass} to="/broker/clients">
          Back to my clients
        </Link>

        <div className="mt-8">
          {state.status !== 'ready' ? (
            <BrokerClientsStatus headingLevel="h1" status={state.status} />
          ) : !client ? (
            <section className="rounded-2xl border border-line bg-surface p-8">
              <h1 className="text-3xl font-semibold tracking-tight">Client not found</h1>
              <p className="mt-3 leading-7 text-muted">
                There is no client with this ID in your referred client list.
              </p>
            </section>
          ) : (
            <>
              <p className="font-mono text-xs font-medium tracking-widest text-muted uppercase">Client file</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight">
                {client.profile?.fullName ?? 'Name unavailable'}
              </h1>
              <dl className="mt-6 flex flex-wrap gap-x-12 gap-y-4">
                <div>
                  <dt className="text-sm text-muted">Client ID</dt>
                  <dd className="mt-1 font-mono text-sm">{client.id}</dd>
                </div>
                {client.profile?.email ? (
                  <div>
                    <dt className="text-sm text-muted">Email</dt>
                    <dd className="mt-1">{client.profile.email}</dd>
                  </div>
                ) : null}
                {client.profile?.county ? (
                  <div>
                    <dt className="text-sm text-muted">County</dt>
                    <dd className="mt-1">{client.profile.county}</dd>
                  </div>
                ) : null}
              </dl>

              <section className="mt-10 rounded-2xl border border-line bg-surface p-8">
                <h2 className="text-xl font-semibold">Applications</h2>
                {client.applications.length === 0 ? (
                  <p className="mt-3 leading-7 text-muted">This client has not started an application yet.</p>
                ) : (
                  <ul className="mt-4 divide-y divide-line">
                    {client.applications.map((application) => (
                      <li className="flex flex-wrap items-center gap-x-8 gap-y-2 py-4" key={application.id}>
                        <span className="font-mono text-sm">{application.id}</span>
                        <StatusBadge status={application.status} />
                        <span className="text-sm text-muted">
                          Requested{' '}
                          <span className="font-mono text-ink">{formatEuro(application.loanAmountEur)}</span>
                        </span>
                        <span className="text-sm text-muted">
                          LTV <span className="font-mono text-ink">{formatPercent(application.ltvPct)}</span>
                        </span>
                        <span className="text-sm text-muted">Updated {formatDate(application.updatedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
