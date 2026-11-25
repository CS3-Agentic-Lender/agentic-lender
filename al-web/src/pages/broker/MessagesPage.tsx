import { useMemo, useState } from 'react';
import { PortalHeader } from '../../components/PortalHeader';
import { Skeleton } from '../../components/Skeleton';
import { Conversation } from '../../components/messaging/Conversation';
import { useAuth } from '../../context/AuthContext';
import { useBrokerClients } from '../../context/BrokerClientsContext';
import { useThreads } from '../../hooks/useThreads';
import { inboxThreads, sortThreads } from './inboxThreads';

const timeFormat = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short' });

export function MessagesPage() {
  const state = useBrokerClients();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const clients = state.status === 'ready' ? state.clients : [];
  const applicationIds = useMemo(
    () => clients.flatMap((client) => client.applications.map((application) => application.id)).sort(),
    [clients],
  );
  const { threads } = useThreads(applicationIds, uid);
  const rows = sortThreads(inboxThreads(clients, threads, uid ?? ''));
  const [selected, setSelected] = useState<string | null>(null);
  const open = rows.find((row) => row.applicationId === selected) ?? null;

  return (
    <div className="min-h-screen bg-oat text-ink">
      <PortalHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted">Broker portal</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Messages</h1>
        <p className="mt-3 text-muted">Your clients' threads, unread first.</p>

        {state.status === 'loading' ? (
          <section aria-busy="true" className="mt-8">
            <p aria-live="polite" className="sr-only" role="status">Loading your clients…</p>
            {/* The thread list beside the reading pane, as they will sit once the clients arrive. */}
            <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
                {['w-40', 'w-32', 'w-44', 'w-36'].map((width) => (
                  <div className="p-4" key={width}>
                    <Skeleton className={`h-4 ${width}`} />
                    <Skeleton className="mt-2 h-3 w-24" />
                    <Skeleton className="mt-2 h-3.5 w-3/4" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-28 rounded-2xl max-lg:hidden" />
            </div>
          </section>
        ) : state.status === 'denied' || state.status === 'error' ? (
          <p className="mt-8 rounded-lg bg-danger-soft p-3 text-error" role="alert">
            Your clients' threads could not be loaded. Reload the page to try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-8 text-muted">No client threads yet. A thread opens when an application is submitted.</p>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <ul aria-label="Threads" className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {rows.map((row) => (
                <li key={row.applicationId}>
                  <button
                    aria-current={row.applicationId === selected ? 'true' : undefined}
                    className={`w-full cursor-pointer p-4 text-left transition-colors hover:bg-tint ${row.applicationId === selected ? 'bg-tint' : ''}`}
                    onClick={() => setSelected(row.applicationId)}
                    type="button"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={row.unread > 0 ? 'font-semibold' : ''}>
                        {row.clientName ?? 'Client name unavailable'}
                      </span>
                      {row.unread > 0 ? (
                        <span className="rounded-full bg-pine px-2 py-0.5 text-xs font-semibold text-surface">
                          {row.unread} unread
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-muted">{row.applicationId}</span>
                    <span className="mt-1 block truncate text-sm text-muted">
                      {!row.loaded ? (
                        <>
                          <Skeleton className="mt-0.5 h-3.5 w-3/4" />
                          <span className="sr-only">Loading…</span>
                        </>
                      ) : row.last
                          ? `${row.last.sentAt ? `${timeFormat.format(row.last.sentAt)}: ` : ''}${row.last.text}`
                          : 'No messages yet'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {open && uid ? (
              <Conversation
                applicationId={open.applicationId}
                key={open.applicationId}
                title={open.clientName ?? 'Client name unavailable'}
                uid={uid}
              />
            ) : (
              <p className="self-start rounded-2xl border border-dashed border-line p-6 text-muted">
                Choose a thread to read it and reply.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
