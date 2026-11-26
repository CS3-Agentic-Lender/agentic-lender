import { useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import { StatTile } from '../../components/admin/StatTile';
import { OverviewSection } from '../../components/overview/OverviewSection';
import { StatusActivity } from '../../components/overview/StatusActivity';
import { Skeleton } from '../../components/Skeleton';
import { StatusBadge, ToneBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useBrokerClients } from '../../context/BrokerClientsContext';
import { useOverviewService } from '../../context/OverviewContext';
import { useLive } from '../../hooks/useLive';
import { useThreads } from '../../hooks/useThreads';
import { clientName, type ApplicationSummary } from '../../services/clientsService';
import type { CommitteeRun } from '../../services/committeeService';
import type { LiveErrorListener, LiveListener } from '../../services/liveCollection';
import { unreadCount } from '../../services/messagesService';
import { plural } from '../../utils/formatters';
import { brokerFigures, needsAttention, recentActivity, type AttentionItem } from '../shared/overviewFigures';

function brokerLoanFilePath(applicationId: string) {
  return `/broker/applications/${encodeURIComponent(applicationId)}`;
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const { application } = item;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Link
          className="inline-flex min-h-11 items-center font-medium text-pine underline underline-offset-4 hover:no-underline"
          to={brokerLoanFilePath(application.id)}
        >
          {item.clientName ?? 'Client name unavailable'}
          <span className="ml-2 font-mono text-muted">{application.id}</span>
        </Link>
        {item.conditions.length > 0 ? (
          <ul className="mt-1 list-disc pl-5 text-muted">
            {item.conditions.map((condition, index) => (
              <li key={`${index}-${condition}`}>{condition}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <StatusBadge status={application.status} />
        {item.conditions.length > 0 ? (
          <ToneBadge tone="tint">{plural(item.conditions.length, 'condition')} to meet</ToneBadge>
        ) : null}
        {item.unread > 0 ? (
          <Link
            className="inline-flex min-h-11 items-center rounded-lg px-2 font-medium text-pine underline underline-offset-4 hover:no-underline"
            to="/broker/messages"
          >
            {plural(item.unread, 'new message')}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function BrokerOverview() {
  const state = useBrokerClients();
  const uid = useAuth().user?.uid ?? null;
  const service = useOverviewService();
  const subscribeToRuns = useCallback(
    (listener: LiveListener<CommitteeRun>, onError: LiveErrorListener) =>
      uid ? service.subscribeToBrokerRuns(uid, listener, onError) : () => {},
    [service, uid],
  );
  const runsState = useLive(subscribeToRuns);

  const clients = useMemo(() => (state.status === 'ready' ? state.clients : []), [state]);
  const applications = useMemo(() => clients.flatMap((client) => client.applications), [clients]);
  const applicationIds = useMemo(() => applications.map((application) => application.id).sort(), [applications]);
  const { threads, failed: failedThreads } = useThreads(applicationIds, uid);
  const unreadByApplication = useMemo(() => {
    const unread = new Map<string, number>();
    threads.forEach((thread, applicationId) => unread.set(applicationId, unreadCount(thread, uid ?? '')));
    return unread;
  }, [threads, uid]);
  const runs = useMemo(
    () => (runsState.status === 'ready' ? new Map(runsState.items.map((run) => [run.id, run])) : null),
    [runsState],
  );

  const loading = state.status === 'loading';
  const failed = state.status === 'denied' || state.status === 'error';
  const threadsLoading = applicationIds.some((id) => !threads.has(id) && !failedThreads.has(id));
  // Rows come from the clients, the committee runs and the threads, so the list waits for all three.
  const attentionLoading = loading || threadsLoading || runsState.status === 'loading';
  const unreadTotal = [...unreadByApplication.values()].reduce((sum, count) => sum + count, 0);
  const figures = brokerFigures(applications);
  const attention = useMemo(
    () => needsAttention(clients, runs, unreadByApplication),
    [clients, runs, unreadByApplication],
  );
  const names = useMemo(() => {
    const byApplication = new Map<string, string | null>();
    clients.forEach((client) => client.applications.forEach((application) => byApplication.set(application.id, clientName(client))));
    return byApplication;
  }, [clients]);
  const activity = useMemo(
    () => recentActivity(applications, (application: ApplicationSummary) => names.get(application.id) ?? null),
    [applications, names],
  );

  if (failed) {
    return (
      <p className="mt-10 rounded-lg bg-danger-soft p-3 text-error" role="alert">
        Your clients' applications could not be loaded. Reload the page to try again.
      </p>
    );
  }

  return (
    <>
      <div aria-live="polite" className="sr-only" role="status">
        {loading ? 'Loading the overview…' : ''}
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          detail="Applied, AI Deliberated or Underwriter Approved."
          label="Active applications"
          loading={loading}
          to="/broker/clients"
          value={figures.active}
        />
        <StatTile
          detail="Applied: the AI committee has not reported yet."
          label="Awaiting AI"
          loading={loading}
          value={figures.awaitingAi}
        />
        <StatTile
          detail={`Underwriter Approved or Funded. ${figures.awaitingFunding} waiting to be funded.`}
          label="Approved"
          loading={loading}
          value={figures.approved}
        />
        <StatTile
          detail={
            failedThreads.size > 0
              ? `${plural(failedThreads.size, 'thread')} could not be read.`
              : 'Messages from others you have not opened.'
          }
          label="Unread messages"
          loading={loading || threadsLoading}
          to="/broker/messages"
          value={unreadTotal}
        />
      </div>

      <OverviewSection
        description="Declined applications, conditions still to meet, and new messages, most recently updated first."
        id="overview-needs-attention"
        title="Needs attention"
      >
        {runsState.status === 'denied' || runsState.status === 'error' ? (
          <p className="mb-4 rounded-lg border border-line bg-tint p-3 text-ink" role="status">
            Committee conditions could not be loaded, so applications with conditions to meet are not listed.
          </p>
        ) : null}
        {attentionLoading ? (
          <div aria-hidden="true" className="card divide-y divide-line">
            {['w-56', 'w-48', 'w-64'].map((width) => (
              <div className="flex items-center gap-4 py-4 first:pt-0 last:pb-0" key={width}>
                <Skeleton className={`h-5 ${width} max-w-full`} />
                <Skeleton className="ml-auto h-6 w-24" />
              </div>
            ))}
          </div>
        ) : attention.length === 0 ? (
          <p className="card text-muted">Nothing needs your attention right now.</p>
        ) : (
          <ul aria-label="Applications that need attention" className="card divide-y divide-line">
            {attention.map((item) => (
              <AttentionRow item={item} key={item.application.id} />
            ))}
          </ul>
        )}
      </OverviewSection>

      <OverviewSection
        description="The latest status moves on your clients' applications."
        id="overview-recent-changes"
        title="Recent status changes"
      >
        <StatusActivity
          empty="No status changes recorded yet."
          entries={loading ? 'loading' : activity}
          hrefFor={brokerLoanFilePath}
          label="Recent status changes"
          viewerUid={uid}
        />
      </OverviewSection>
    </>
  );
}
