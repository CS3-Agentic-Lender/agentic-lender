import { m } from 'motion/react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { LiveStatus, LoadingPanel, StatusPanel } from '../../../components/admin/StatusPanel';
import { ChartTip, useChartTips } from '../../../components/admin/ChartTip';
import { StatTile } from '../../../components/admin/StatTile';
import { Skeleton, SkeletonCard } from '../../../components/Skeleton';
import { useApplications, useReviews, useRuns, useSupportRequests } from '../../../context/AdminDataContext';
import type { LiveState } from '../../../hooks/useLive';
import type { CommitteeRun } from '../../../services/committeeService';
import { inboxSummary } from '../../../services/inboxService';
import type { LoanFileApplication } from '../../../services/loanFileService';
import { ChainSection } from './ChainSection';
import { BarList, BusinessPage, plural, type Bar } from './BusinessPage';
import {
  applicationsHref,
  decisionRates,
  tallyLoanTypes,
  tallyMonths,
  tallyRuns,
  tallyStatuses,
  type MonthTally,
  type Tally,
} from './figures';

const percent = new Intl.NumberFormat('en-IE', { style: 'percent', maximumFractionDigits: 0 });
const rating = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// A count's share of the whole, for a tooltip: "25% of 4 applications".
function shareOf(count: number, whole: number, of: string) {
  return whole === 0 ? undefined : `${percent.format(count / whole)} of ${of}`;
}

const counts: Record<'status' | 'loanType', (label: string) => string> = {
  status: (label) => `Applications whose status is now ${label}.`,
  loanType: (label) => `${label} applications, at any status.`,
};

function applicationBars(tallies: Tally[], filter: 'status' | 'loanType'): Bar[] {
  const whole = tallies.reduce((sum, tally) => sum + tally.count, 0);

  return tallies.map(({ key, label, count }) => ({
    key,
    label,
    count,
    // Applications with no loan type have no filter value to link to.
    to: key ? applicationsHref({ [filter]: key }) : undefined,
    name: `${label}: ${plural(count, 'application')}.${key ? ' Show them.' : ''}`,
    tip: {
      value: plural(count, 'application'),
      share: shareOf(count, whole, plural(whole, 'application')),
      counts: key ? counts[filter](label) : 'Applications with no loan type stored, so no list filters on them.',
    },
  }));
}

// Applications opened per month: one column each, the count on its cap, square at the baseline.
function MonthColumns({ months }: { months: MonthTally[] }) {
  const largest = Math.max(1, ...months.map((month) => month.count));
  const whole = months.reduce((sum, month) => sum + month.count, 0);
  const tips = useChartTips();

  return (
    <ol aria-label="Applications opened per month" className="mt-4 grid grid-cols-6 gap-1 sm:gap-2">
      {months.map((month, index) => {
        const name = `${month.name}: ${plural(month.count, 'application')} opened. Show them.`;
        const { tip, trigger } = tips(index, true);

        return (
          <li key={month.key}>
            <Link
              aria-label={name}
              className="group relative flex flex-col items-center rounded-lg px-1 pt-2 pb-1 transition-colors hover:bg-oat"
              to={applicationsHref({ from: month.from, to: month.to })}
              {...trigger}
            >
              <ChartTip
                {...tip}
                // The outer columns open inwards so the tooltip stays on a phone screen.
                align={index < 2 ? 'start' : index >= months.length - 2 ? 'end' : 'center'}
                tip={{
                  value: plural(month.count, 'application'),
                  share: shareOf(month.count, whole, `the ${whole} opened in the last six months`),
                  counts: `Applications opened in ${month.name}: created then, or submitted then when no creation time is stored.`,
                }}
              />
              <span className="flex h-36 w-full flex-col items-center justify-end border-b border-line">
                <span className="text-sm font-semibold tabular-nums">{month.count}</span>
                <m.span
                  animate={{ scaleY: 1 }}
                  className="mt-1 block w-full max-w-6 origin-bottom rounded-t bg-pine"
                  initial={{ scaleY: 0 }}
                  style={{ height: `${(month.count / largest) * 75}%` }}
                  transition={{ duration: 0.6, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
              <span className="mt-2 text-xs text-muted">{month.label}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function ApplicationFigures({ applications }: { applications: LoanFileApplication[] }) {
  const figures = useMemo(() => {
    const rates = decisionRates(applications);

    return {
      statuses: applicationBars(tallyStatuses(applications), 'status'),
      loanTypes: applicationBars(tallyLoanTypes(applications), 'loanType'),
      months: tallyMonths(applications, new Date()),
      decisions: (['approved', 'declined'] as const).map((outcome) => {
        const count = rates[outcome];
        const share = rates[outcome === 'approved' ? 'approvalRate' : 'declineRate'];
        const note = share === null ? undefined : `${percent.format(share)} of decided`;
        const label = outcome === 'approved' ? 'Approved' : 'Declined';
        return {
          key: outcome,
          label,
          count,
          note,
          to: applicationsHref({ decision: outcome }),
          name: `${label}: ${plural(count, 'application')}${note ? `, ${note}` : ''}. Show them.`,
          tip: {
            value: plural(count, 'application'),
            share: shareOf(count, rates.decided, `${rates.decided} decided`),
            counts: `Applications an underwriter has ${outcome}, whatever their status now.`,
          },
        };
      }),
    };
  }, [applications]);

  if (applications.length === 0) {
    return (
      <StatusPanel
        detail="Applications appear here as borrowers start them in the app, with their status, type and decision."
        heading="No applications yet"
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <section aria-labelledby="business-months" className="card lg:col-span-2">
        <h2 className="card-title" id="business-months">
          Applications over time
        </h2>
        <p className="mt-1 text-sm text-muted">Opened per month, the last six months.</p>
        <MonthColumns months={figures.months} />
      </section>
      <section aria-labelledby="business-status" className="card lg:row-span-2">
        <h2 className="card-title" id="business-status">
          By status
        </h2>
        <BarList bars={figures.statuses} label="Applications by status" />
      </section>
      <section aria-labelledby="business-type" className="card">
        <h2 className="card-title" id="business-type">
          By loan type
        </h2>
        <BarList bars={figures.loanTypes} label="Applications by loan type" />
      </section>
      <section aria-labelledby="business-decisions" className="card">
        <h2 className="card-title" id="business-decisions">
          Decisions
        </h2>
        <BarList bars={figures.decisions} label="Underwriter decisions" />
      </section>
    </div>
  );
}

// The four application charts in placeholders, laid out as ApplicationFigures lays them out.
function ApplicationFiguresSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="card lg:col-span-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-2 h-4 w-56" />
        <div className="mt-4 grid h-36 grid-cols-6 items-end gap-1 border-b border-line sm:gap-2">
          {['h-1/2', 'h-2/3', 'h-1/3', 'h-3/4', 'h-1/2', 'h-2/5'].map((height, index) => (
            <Skeleton className={`mx-auto w-full max-w-6 rounded-b-none ${height}`} key={index} />
          ))}
        </div>
        <Skeleton className="mt-3 h-3 w-full" />
      </div>
      <SkeletonCard className="lg:row-span-2" rows={7} />
      <SkeletonCard rows={3} />
      <SkeletonCard rows={2} />
    </div>
  );
}

function RunFigures({ state }: { state: LiveState<CommitteeRun> }) {
  if (state.status === 'loading') {
    return (
      <LoadingPanel className="mt-3" label="Loading the committee runs">
        <div className="grid gap-x-8 sm:grid-cols-3">
          {['w-20', 'w-24', 'w-16'].map((width) => (
            <div className="py-2.5" key={width}>
              <div className="flex justify-between gap-3">
                <Skeleton className={`h-5 ${width}`} />
                <Skeleton className="h-5 w-6" />
              </div>
              <Skeleton className="mt-2 h-2 rounded-full" />
            </div>
          ))}
        </div>
      </LoadingPanel>
    );
  }

  if (state.status !== 'ready') {
    return (
      <p className="mt-3 text-muted" role="alert">
        The committee runs could not be loaded.
      </p>
    );
  }

  if (state.items.length === 0) {
    return <p className="mt-3 text-muted">No committee runs yet.</p>;
  }

  const whole = state.items.length;
  const bars = tallyRuns(state.items).map(({ key, label, count }) => ({
    key,
    label,
    count,
    to: `/admin/business/ai-runs?status=${key}`,
    name: `${label}: ${plural(count, 'run')}. Show them.`,
    tip: {
      value: plural(count, 'run'),
      share: shareOf(count, whole, plural(whole, 'run')),
      counts: `AI committee runs that are ${label.toLowerCase()}.`,
    },
  }));

  return <BarList bars={bars} className="grid gap-x-8 sm:grid-cols-3" label="Committee runs by status" />;
}

function waiting(state: LiveState<unknown>, what: string) {
  return state.status === 'loading' ? `Loading the ${what}.` : `The ${what} could not be loaded.`;
}

export function OverviewPage() {
  const applications = useApplications();
  const runs = useRuns();
  const requests = useSupportRequests();
  const reviews = useReviews();
  const items = applications.status === 'ready' ? applications.items : null;
  const rates = useMemo(() => (items ? decisionRates(items) : null), [items]);
  const opened = useMemo(() => (items ? tallyMonths(items, new Date(), 1)[0].count : null), [items]);
  const inbox =
    requests.status === 'ready' && reviews.status === 'ready' ? inboxSummary(requests.items, reviews.items) : null;
  // The inbox tiles need both lists: one that failed says so, otherwise they load.
  const inboxLoading =
    inbox === null && ![requests, reviews].some((state) => state.status === 'denied' || state.status === 'error');

  return (
    <BusinessPage
      description="How the business is doing at a glance. Every figure opens the list behind it. Nothing here can be changed."
      title="Business"
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        <StatTile
          detail={opened === null ? waiting(applications, 'applications') : `${opened} opened this month.`}
          label="Applications"
          loading={applications.status === 'loading'}
          to={applicationsHref()}
          value={items?.length ?? null}
        />
        <StatTile
          detail={
            rates === null
              ? waiting(applications, 'applications')
              : rates.decided === 0
                ? 'Nothing decided yet.'
                : `${rates.approved} approved of ${rates.decided} decided.`
          }
          label="Approval rate"
          loading={applications.status === 'loading'}
          to={applicationsHref({ decision: 'approved' })}
          value={rates === null ? null : rates.approvalRate === null ? '—' : percent.format(rates.approvalRate)}
        />
        <StatTile
          detail={
            inbox
              ? inbox.reviews === 0
                ? 'No reviews yet.'
                : `Out of 5, from ${plural(inbox.reviews, 'review')}.`
              : waiting(reviews.status === 'ready' ? requests : reviews, 'reviews')
          }
          label="Average review"
          loading={inboxLoading}
          to="/admin/inbox?tab=reviews"
          value={inbox ? (inbox.averageRating === null ? '—' : rating.format(inbox.averageRating)) : null}
        />
        <StatTile
          detail={
            inbox
              ? `${plural(inbox.closed, 'closed request')} so far.`
              : waiting(requests.status === 'ready' ? reviews : requests, 'support requests')
          }
          label="Open support requests"
          loading={inboxLoading}
          to="/admin/inbox"
          value={inbox?.open ?? null}
        />
      </div>

      <div className="mt-5">
        {applications.status === 'ready' ? (
          <ApplicationFigures applications={applications.items} />
        ) : (
          <LiveStatus skeleton={<ApplicationFiguresSkeleton />} state={applications} what="applications" />
        )}
      </div>

      <section aria-labelledby="business-runs" className="card mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="card-title" id="business-runs">
            Committee runs
          </h2>
          <Link className="text-sm font-semibold text-pine underline-offset-4 hover:underline" to="/admin/business/ai-runs">
            All runs
          </Link>
        </div>
        <RunFigures state={runs} />
      </section>

      <ChainSection applications={applications} />
    </BusinessPage>
  );
}
