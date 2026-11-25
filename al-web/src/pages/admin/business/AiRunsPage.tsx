import { useDeferredValue, useMemo } from 'react';
import { DataTable, type Column } from '../../../components/admin/DataTable';
import { SearchField, matchesSearch } from '../../../components/admin/SearchField';
import { SegmentedFilter } from '../../../components/admin/SegmentedFilter';
import { ListSkeleton, LiveStatus, StatusPanel } from '../../../components/admin/StatusPanel';
import { ToneBadge } from '../../../components/StatusBadge';
import { useApplications, useRuns } from '../../../context/AdminDataContext';
import { runDuration, type CommitteeRun } from '../../../services/committeeService';
import type { BadgeTone } from '../../../utils/statusTone';
import { formatDateTime } from '../../../utils/formatters';
import { BusinessPage, NONE, RowLink, plural, useUrlFilters } from './BusinessPage';
import { RUN_STATUSES, runStatusLabels, type RunStatus } from './figures';

type StatusFilter = RunStatus | 'all';

const runTones: Record<RunStatus, BadgeTone> = { complete: 'success', failed: 'danger', running: 'tint' };

interface RunRow {
  run: CommitteeRun;
  borrowerName: string | null;
}

const runColumns: Column<RunRow>[] = [
  {
    id: 'application',
    header: 'Application',
    primary: true,
    sortValue: (row) => row.borrowerName ?? row.run.applicationId,
    cell: ({ run, borrowerName }) => (
      <div className="min-w-0">
        {run.applicationId ? (
          <RowLink to={`/admin/applications/${encodeURIComponent(run.applicationId)}`}>
            {borrowerName ?? 'Name not recorded'}
          </RowLink>
        ) : (
          <p className="text-muted">Application not recorded</p>
        )}
        <p className="font-mono text-sm break-all text-muted">{run.applicationId}</p>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    sortValue: ({ run }) => run.status,
    cell: ({ run }) =>
      run.status === null ? NONE : <ToneBadge tone={runTones[run.status]}>{runStatusLabels[run.status]}</ToneBadge>,
  },
  {
    id: 'trigger',
    header: 'Trigger',
    sortValue: ({ run }) => run.trigger,
    cell: ({ run }) => (run.trigger === null ? NONE : run.trigger === 'rerun' ? 'Re-run' : 'Submitted'),
  },
  {
    id: 'started',
    header: 'Started',
    sortValue: ({ run }) => run.startedAt?.getTime() ?? null,
    cell: ({ run }) => <span className="whitespace-nowrap">{formatDateTime(run.startedAt)}</span>,
  },
  {
    id: 'duration',
    header: 'Took',
    sortValue: ({ run }) =>
      run.startedAt && run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
    cell: ({ run }) => <span className="whitespace-nowrap tabular-nums">{runDuration(run) ?? '—'}</span>,
  },
  {
    id: 'failure',
    header: 'Failure',
    cell: ({ run }) =>
      run.failedStep === null && run.failureReason === null ? (
        NONE
      ) : (
        <div className="min-w-0 max-md:text-right md:max-w-64">
          {run.failedStep ? <p className="font-mono text-sm break-all">{run.failedStep}</p> : null}
          {run.failureReason ? <p className="text-sm break-words text-muted">{run.failureReason}</p> : null}
        </div>
      ),
  },
];

export function AiRunsPage() {
  const runs = useRuns();
  const applications = useApplications();
  const { params, setFilter } = useUrlFilters();
  const status: StatusFilter = RUN_STATUSES.find((value) => value === params.get('status')) ?? 'all';
  const search = params.get('q') ?? '';
  const query = useDeferredValue(search);

  const rows = useMemo<RunRow[]>(() => {
    if (runs.status !== 'ready') return [];
    const names = new Map(
      applications.status === 'ready'
        ? applications.items.map((application) => [application.id, application.borrowerName ?? null])
        : [],
    );
    return runs.items.map((run) => ({ run, borrowerName: run.applicationId ? names.get(run.applicationId) ?? null : null }));
  }, [runs, applications]);

  const visible = useMemo(
    () =>
      rows.filter(
        ({ run, borrowerName }) =>
          (status === 'all' || run.status === status) &&
          matchesSearch(query, borrowerName, run.applicationId, run.id, run.failedStep),
      ),
    [rows, status, query],
  );

  return (
    <BusinessPage
      description="Each run of the AI committee, newest first: how it was started, how long it took, and where a failed one stopped."
      title="AI runs"
    >
      {runs.status !== 'ready' ? (
        <LiveStatus
          skeleton={<ListSkeleton columns={runColumns.length} segments={RUN_STATUSES.length + 1} />}
          state={runs}
          what="committee runs"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <SearchField
              label="Search runs"
              onChange={(value) => setFilter('q', value)}
              placeholder="Borrower, application, run or step"
              value={search}
            />
            <SegmentedFilter
              legend="Status"
              onChange={(next) => setFilter('status', next === 'all' ? null : next)}
              options={(['all', ...RUN_STATUSES] as const).map((value) => ({
                value,
                label: value === 'all' ? 'All' : runStatusLabels[value],
                count: value === 'all' ? rows.length : rows.filter((row) => row.run.status === value).length,
              }))}
              value={status}
            />
          </div>
          <p className="mt-5 text-sm text-muted" role="status">
            {visible.length === rows.length
              ? `Showing all ${plural(rows.length, 'run')}.`
              : `Showing ${visible.length} of ${plural(rows.length, 'run')}.`}
          </p>
          <div className="mt-4">
            <DataTable
              caption="Committee runs"
              columns={runColumns}
              defaultSort={{ column: 'started', direction: 'desc' }}
              empty={
                <StatusPanel
                  detail={
                    rows.length === 0
                      ? 'A run starts each time a borrower submits an application.'
                      : 'No run matches this search and status. Clear the search or pick another status.'
                  }
                  heading={rows.length === 0 ? 'No committee runs yet' : 'No matches'}
                />
              }
              rowHref={({ run }) =>
                run.applicationId ? `/admin/applications/${encodeURIComponent(run.applicationId)}` : undefined
              }
              rowKey={({ run }) => run.id}
              rows={visible}
            />
          </div>
        </>
      )}
    </BusinessPage>
  );
}
