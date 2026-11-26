import { useMemo } from 'react';
import { Link } from 'react-router';
import { DataTable, type Column } from '../../components/admin/DataTable';
import { StatTile } from '../../components/admin/StatTile';
import { OverviewSection } from '../../components/overview/OverviewSection';
import { StatusActivity } from '../../components/overview/StatusActivity';
import { SkeletonTable } from '../../components/Skeleton';
import { useAuth } from '../../context/AuthContext';
import { usePipeline } from '../../context/PipelineContext';
import type { PipelineApplication } from '../../services/pipelineService';
import { formatDate, formatEuro, formatPercent, loanTypeLabel, plural } from '../../utils/formatters';
import {
  awaitingDecision,
  recentActivity,
  underwriterFigures,
  type WaitingApplication,
} from '../shared/overviewFigures';
import { formatLtv, loanFilePath } from './pipelineGroups';

const columns: Column<WaitingApplication<PipelineApplication>>[] = [
  {
    id: 'application',
    header: 'Application',
    primary: true,
    cell: ({ application }) => (
      <Link
        className="inline-flex min-h-11 items-center font-mono font-medium text-pine underline underline-offset-4 hover:no-underline"
        to={loanFilePath(application.id)}
      >
        {application.id}
      </Link>
    ),
  },
  {
    id: 'borrower',
    header: 'Borrower',
    cell: ({ application }) => application.borrowerName ?? <span className="text-muted">Not stored</span>,
  },
  {
    id: 'type',
    header: 'Type',
    cell: ({ application }) => loanTypeLabel(application.loanType) ?? <span className="text-muted">Not stored</span>,
  },
  {
    id: 'amount',
    header: 'Requested',
    className: 'font-mono',
    cell: ({ application }) => formatEuro(application.loanAmountEur),
  },
  {
    id: 'ltv',
    header: 'Valuation LTV',
    className: 'font-mono',
    cell: ({ application }) => formatLtv(application.ltvPct),
  },
  {
    id: 'tier',
    header: 'Risk tier',
    cell: ({ application }) =>
      application.riskTier && application.riskTier !== 'invalid' ? (
        <span className="font-mono">{application.riskTier}</span>
      ) : (
        <span className="text-muted">No tier</span>
      ),
  },
  {
    id: 'since',
    header: 'Waiting since',
    className: 'whitespace-nowrap',
    cell: ({ since }) => formatDate(since),
  },
];

export function UnderwriterOverview({ now }: { now?: Date }) {
  const state = usePipeline();
  const uid = useAuth().user?.uid ?? null;
  const applications = state.status === 'ready' ? state.applications : null;
  // "This week" is worked out afresh for every snapshot, so a tab left open past Monday does not keep last
  // week's count. `now` is for tests only; the activity feed reads the clock itself when it is not given.
  const figures = useMemo(
    () => (applications ? underwriterFigures(applications, now ?? new Date()) : null),
    [applications, now],
  );
  const waiting = useMemo(() => (applications ? awaitingDecision(applications) : []), [applications]);
  const activity = useMemo(() => (applications ? recentActivity(applications) : []), [applications]);
  const loading = state.status === 'loading';
  const failed = state.status === 'denied' || state.status === 'error';

  return (
    <>
      {failed ? (
        <p className="mt-10 rounded-lg bg-danger-soft p-3 text-error" role="alert">
          {state.status === 'denied'
            ? 'This account cannot read the applications, so the overview cannot be shown.'
            : 'The applications could not be loaded. Reload the page to try again.'}
        </p>
      ) : null}

      <div aria-live="polite" className="sr-only" role="status">
        {loading ? 'Loading the overview…' : ''}
      </div>

      {failed ? null : (
        <>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              detail={
                waiting[0]?.since
                  ? `AI Deliberated. Oldest waiting since ${formatDate(waiting[0].since)}.`
                  : 'AI Deliberated: the committee has reported.'
              }
              label="Awaiting decision"
              loading={loading}
              value={figures?.awaitingDecision ?? null}
            />
            <StatTile
              detail={
                figures && figures.aiFailed > 0
                  ? `Committee runs in progress. ${plural(figures.aiFailed, 'run')} failed.`
                  : 'Committee runs in progress.'
              }
              label="AI running"
              loading={loading}
              value={figures?.aiRunning ?? null}
            />
            <StatTile
              detail="Moved to Underwriter Approved since Monday."
              label="Approved this week"
              loading={loading}
              value={figures?.approvedThisWeek ?? null}
            />
            <StatTile
              detail={
                figures && figures.ltvCount > 0
                  ? `Across ${plural(figures.ltvCount, 'application')} with a stored LTV.`
                  : 'No submitted application has a stored LTV yet.'
              }
              label="Average indicative LTV"
              loading={loading}
              value={figures?.averageLtvPct == null ? null : formatPercent(figures.averageLtvPct)}
            />
          </div>

          <OverviewSection
            description="Applications the AI committee has reported on, the one waiting longest first."
            id="overview-needs-decision"
            title="Needs your decision"
          >
            {loading ? (
              <SkeletonTable columns={5} rows={3} />
            ) : (
              <DataTable
                caption="Applications waiting for your decision, oldest first"
                columns={columns}
                empty={<p className="card text-muted">Nothing waiting for you. New committee results appear here.</p>}
                rowHref={({ application }) => loanFilePath(application.id)}
                rowKey={({ application }) => application.id}
                rows={waiting}
              />
            )}
          </OverviewSection>

          <OverviewSection
            description="The latest status moves across all applications."
            id="overview-recent-activity"
            title="Recent activity"
          >
            <StatusActivity
              empty="No status moves recorded yet."
              entries={loading ? 'loading' : activity}
              hrefFor={loanFilePath}
              label="Recent status moves"
              now={now}
              viewerUid={uid}
            />
          </OverviewSection>
        </>
      )}
    </>
  );
}
