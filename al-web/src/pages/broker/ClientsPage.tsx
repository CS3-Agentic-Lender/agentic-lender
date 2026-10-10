import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PortalHeader } from '../../components/PortalHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useBrokerClients } from '../../context/BrokerClientsContext';
import { APPLICATION_STATUSES } from '../../services/clientsService';
import { formatDate, formatEuro, formatPercent } from '../../utils/formatters';
import { BrokerClientsStatus } from './BrokerClientsStatus';
import { ALL_STATUSES, filterClientRows, toClientRows, type ClientRow } from './clientRows';

const headerCellClass = 'px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase';
const cellClass = 'px-4 py-4 align-middle';

function ClientTableRow({ client, application }: ClientRow) {
  return (
    <tr className="border-t border-line">
      <th className={`${cellClass} text-left font-normal`} scope="row">
        <Link
          className="font-medium text-pine underline-offset-4 hover:underline"
          to={`/broker/clients/${encodeURIComponent(client.id)}`}
        >
          {client.profile?.fullName ?? 'Name unavailable'}
        </Link>
        <span className="mt-1 block font-mono text-xs text-muted">{client.id}</span>
      </th>
      {application ? (
        <>
          <td className={`${cellClass} font-mono text-sm`}>{application.id}</td>
          <td className={`${cellClass} font-mono text-sm`}>{formatEuro(application.loanAmountEur)}</td>
          <td className={`${cellClass} font-mono text-sm`}>{formatPercent(application.ltvPct)}</td>
          <td className={cellClass}>
            <StatusBadge status={application.status} />
          </td>
          <td className={`${cellClass} text-sm whitespace-nowrap`}>{formatDate(application.updatedAt)}</td>
        </>
      ) : (
        <td className={`${cellClass} text-sm text-muted`} colSpan={5}>
          No application yet
        </td>
      )}
    </tr>
  );
}

export function ClientsPage() {
  const state = useBrokerClients();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL_STATUSES);

  const rows = useMemo(() => (state.status === 'ready' ? toClientRows(state.clients) : []), [state]);
  const visibleRows = useMemo(() => filterClientRows(rows, { search, status }), [rows, search, status]);

  return (
    <div className="min-h-screen bg-oat text-ink">
      <PortalHeader />

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="font-mono text-xs font-medium tracking-widest text-muted uppercase">Broker portal</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">My clients</h1>
        <p className="mt-4 max-w-2xl leading-7 text-muted">
          Only clients assigned or referred to you are shown.
        </p>

        <div className="mt-10">
          {state.status !== 'ready' ? (
            <BrokerClientsStatus status={state.status} />
          ) : rows.length === 0 ? (
            <section className="rounded-2xl border border-line bg-surface p-8">
              <h2 className="text-xl font-semibold">No clients yet</h2>
              <p className="mt-3 leading-7 text-muted">
                Clients appear here as soon as a borrower chooses you as their broker.
              </p>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-4">
                <div className="w-full sm:w-96">
                  <label className="mb-2 block text-sm font-semibold" htmlFor="client-search">
                    Search
                  </label>
                  <input
                    className="min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-ink placeholder:text-muted"
                    id="client-search"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Client name, client ID or application ID"
                    type="search"
                    value={search}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold" htmlFor="client-status">
                    Status
                  </label>
                  <select
                    className="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-ink"
                    id="client-status"
                    onChange={(event) => setStatus(event.target.value)}
                    value={status}
                  >
                    <option value={ALL_STATUSES}>All statuses</option>
                    {APPLICATION_STATUSES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <p aria-live="polite" className="ml-auto text-sm text-muted">
                  Showing {visibleRows.length} of {rows.length}
                </p>
              </div>

              {state.profilesAvailable ? null : (
                <p className="mt-6 rounded-lg border border-line bg-tint p-3 text-sm text-ink">
                  Client names are not available yet, so clients are listed by ID.
                </p>
              )}

              <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full min-w-3xl border-collapse">
                  <caption className="sr-only">Clients referred to you and their applications</caption>
                  <thead className="bg-oat">
                    <tr>
                      <th className={headerCellClass} scope="col">
                        Client
                      </th>
                      <th className={headerCellClass} scope="col">
                        Application
                      </th>
                      <th className={headerCellClass} scope="col">
                        Requested
                      </th>
                      <th className={headerCellClass} scope="col">
                        LTV
                      </th>
                      <th className={headerCellClass} scope="col">
                        Status
                      </th>
                      <th className={headerCellClass} scope="col">
                        Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 ? (
                      <tr className="border-t border-line">
                        <td className={`${cellClass} text-muted`} colSpan={6}>
                          No clients match these filters.
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((row) => (
                        <ClientTableRow
                          application={row.application}
                          client={row.client}
                          key={`${row.client.id}:${row.application?.id ?? 'none'}`}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
