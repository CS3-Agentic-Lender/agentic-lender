import { useMemo, useState } from 'react';
import { PortalHeader } from '../../components/PortalHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { usePipeline } from '../../context/PipelineContext';
import { APPLICATION_STATUSES } from '../../services/clientsService';
import type { PipelineApplication, PipelineError, RiskTierState } from '../../services/pipelineService';
import { formatDate, formatEuro } from '../../utils/formatters';
import { PipelineStatus } from './PipelineStatus';
import {
  ALL_STATUSES,
  GROUP_BY_OPTIONS,
  INVALID_RISK_TIER,
  applicationLtvBand,
  filterByStatus,
  formatLtv,
  groupApplications,
  type GroupBy,
} from './pipelineGroups';

const COLUMN_COUNT = 6;
const headerCellClass = 'px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase';
const cellClass = 'px-4 py-4 align-middle';
const groupOptionClass = [
  'inline-flex min-h-11 cursor-pointer items-center rounded-lg px-4 font-medium text-muted transition-colors',
  'hover:bg-tint hover:text-pine has-[:checked]:bg-tint has-[:checked]:text-pine',
  'has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-pine',
].join(' ');

// Shown only once the tier query has failed, never while it is pending. The cause is stated generically.
const riskTierNotices: Record<PipelineError, string> = {
  'permission-denied':
    'Risk tiers could not be read for this account. Applications without a stored tier show Unavailable.',
  unavailable:
    'Risk tiers could not be loaded. Applications without a stored tier show Unavailable. Reload the page to try again.',
};

function countLabel(count: number) {
  return count === 1 ? '1 application' : `${count} applications`;
}

interface PipelineTableRowProps {
  application: PipelineApplication;
  riskTierState: RiskTierState;
}

function PipelineTableRow({ application, riskTierState }: PipelineTableRowProps) {
  return (
    <tr className="border-t border-line">
      <th className={`${cellClass} text-left font-mono text-sm font-normal`} scope="row">
        {application.id}
      </th>
      <td className={`${cellClass} font-mono text-sm`}>{formatEuro(application.loanAmountEur)}</td>
      <td className={`${cellClass} text-sm`}>
        <span className="font-mono">{formatLtv(application.ltvPct)}</span>
        <span className="ml-2 text-xs whitespace-nowrap text-muted">
          {applicationLtvBand(application)}
        </span>
      </td>
      <td className={`${cellClass} text-sm`}>
        {application.storedRiskTier === 'invalid' ? (
          <span className="text-muted">{INVALID_RISK_TIER}</span>
        ) : application.storedRiskTier ? (
          <span className="font-mono">{application.storedRiskTier}</span>
        ) : riskTierState === 'pending' ? (
          <span className="text-muted">Checking</span>
        ) : riskTierState !== 'available' ? (
          <span className="text-muted">Unavailable</span>
        ) : application.riskTier ? (
          <span className="font-mono">{application.riskTier}</span>
        ) : (
          <span className="text-muted">No tier yet</span>
        )}
      </td>
      <td className={cellClass}>
        <StatusBadge status={application.status} />
      </td>
      <td className={`${cellClass} text-sm whitespace-nowrap`}>{formatDate(application.updatedAt)}</td>
    </tr>
  );
}

export function PipelinePage() {
  const state = usePipeline();
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [status, setStatus] = useState(ALL_STATUSES);

  const applications = state.status === 'ready' ? state.applications : null;
  const riskTierState = state.status === 'ready' ? state.riskTierState : 'pending';
  const visible = useMemo(() => filterByStatus(applications ?? [], status), [applications, status]);
  const needsFallbackTier = visible.some((application) => application.storedRiskTier == null);
  const riskTierNotice =
    needsFallbackTier && state.status === 'ready' && riskTierState === 'unavailable'
      ? riskTierNotices[state.riskTierError ?? 'unavailable']
      : null;
  const groups = useMemo(
    () => groupApplications(visible, groupBy, riskTierState),
    [visible, groupBy, riskTierState],
  );

  return (
    <div className="min-h-screen bg-oat text-ink">
      <PortalHeader />

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="font-mono text-xs font-medium tracking-widest text-muted uppercase">
          Underwriter portal
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Pipeline queue</h1>
        <p className="mt-4 max-w-2xl leading-7 text-muted">
          Every application you are allowed to read, updated live. Group the queue by LTV band, risk
          tier or status.
        </p>

        <div className="mt-10">
          {state.status !== 'ready' ? (
            <PipelineStatus status={state.status} />
          ) : state.applications.length === 0 ? (
            <section className="rounded-2xl border border-line bg-surface p-8">
              <h2 className="text-xl font-semibold">No applications yet</h2>
              <p className="mt-3 leading-7 text-muted">
                Applications appear here as soon as one is created.
              </p>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                <fieldset className="min-w-0">
                  <legend className="mb-2 text-sm font-semibold">Group by</legend>
                  <div className="flex flex-wrap gap-1">
                    {GROUP_BY_OPTIONS.map((option) => (
                      <label className={groupOptionClass} key={option.value}>
                        <input
                          checked={groupBy === option.value}
                          className="sr-only"
                          name="pipeline-group-by"
                          onChange={() => setGroupBy(option.value)}
                          type="radio"
                          value={option.value}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label className="mb-2 block text-sm font-semibold" htmlFor="pipeline-status">
                    Status filter
                  </label>
                  <select
                    className="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-ink"
                    id="pipeline-status"
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
                <p className="ml-auto max-w-sm text-sm text-muted" role="status">
                  {status === ALL_STATUSES
                    ? `Showing all ${countLabel(state.applications.length)}. Group counts are of all applications.`
                    : `Showing ${visible.length} of ${countLabel(state.applications.length)}, filtered to ${status}. Group counts are of the filtered applications only.`}
                </p>
              </div>

              {riskTierNotice ? (
                <p
                  className="mt-6 rounded-lg border border-line bg-tint p-3 text-sm text-ink"
                  role="status"
                >
                  {riskTierNotice}
                </p>
              ) : null}

              <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full min-w-3xl border-collapse">
                  <caption className="sr-only">
                    Applications in the pipeline, grouped by{' '}
                    {GROUP_BY_OPTIONS.find((option) => option.value === groupBy)?.label}
                  </caption>
                  <thead className="bg-oat">
                    <tr>
                      <th className={headerCellClass} scope="col">
                        Application
                      </th>
                      <th className={headerCellClass} scope="col">
                        Requested
                      </th>
                      <th className={headerCellClass} scope="col">
                        Valuation LTV
                      </th>
                      <th className={headerCellClass} scope="col">
                        Risk tier
                      </th>
                      <th className={headerCellClass} scope="col">
                        Status
                      </th>
                      <th className={headerCellClass} scope="col">
                        Updated
                      </th>
                    </tr>
                  </thead>
                  {groups.length === 0 ? (
                    <tbody>
                      <tr className="border-t border-line">
                        <td className={`${cellClass} text-muted`} colSpan={COLUMN_COUNT}>
                          No applications match this status.
                        </td>
                      </tr>
                    </tbody>
                  ) : (
                    groups.map((group, index) => (
                      <tbody aria-labelledby={`pipeline-group-${index}`} key={group.key}>
                        <tr className="border-t border-line bg-tint">
                          <th className="px-4 py-3 text-left" colSpan={COLUMN_COUNT} scope="rowgroup">
                            <span className="font-semibold text-pine" id={`pipeline-group-${index}`}>
                              {group.label}
                            </span>
                            <span className="ml-3 text-sm font-normal text-muted">
                              {countLabel(group.applications.length)}
                            </span>
                          </th>
                        </tr>
                        {group.applications.map((application) => (
                          <PipelineTableRow
                            application={application}
                            key={application.id}
                            riskTierState={riskTierState}
                          />
                        ))}
                      </tbody>
                    ))
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
