import { useMemo } from 'react';
import { Link } from 'react-router';
import { AdminPage } from '../../components/admin/AdminPage';
import { LiveStatus, LoadingPanel } from '../../components/admin/StatusPanel';
import { StatTile } from '../../components/admin/StatTile';
import { Skeleton } from '../../components/Skeleton';
import { useRecentActivity, useReviews, useSupportRequests } from '../../context/AdminDataContext';
import { useStaff, type StaffState } from '../../context/StaffContext';
import { describeAdminAction, recordedNames, type AdminAction } from '../../services/adminActivityService';
import { inboxSummary } from '../../services/inboxService';
import { STAFF_ROLES, staffRoleLabels, type StaffMember } from '../../services/staffService';
import { formatDateTime, formatRating, formatRelative, plural } from '../../utils/formatters';

function StaffSummary({ state }: { state: StaffState }) {
  const staff = state.status === 'ready' ? state.staff : [];
  const disabled = staff.filter((member) => !member.enabled).length;

  return (
    <section aria-labelledby="dashboard-staff" className="card">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="eyebrow" id="dashboard-staff">
          Staff
        </h2>
        <Link className="text-sm font-semibold text-pine underline-offset-4 hover:underline" to="/admin/staff">
          Manage staff
        </Link>
      </div>
      {state.status === 'loading' ? (
        <LoadingPanel label="Loading the staff">
          <div className="mt-4 grid grid-cols-3 gap-3">
            {STAFF_ROLES.map((role) => (
              <div key={role}>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="mt-2 h-8 w-10" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-4 h-4 w-44" />
        </LoadingPanel>
      ) : state.status === 'error' ? (
        <p className="mt-4 text-muted" role="alert">
          The staff list could not be loaded. {state.message}
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            {STAFF_ROLES.map((role) => (
              <div key={role}>
                <dt className="text-sm text-muted">{staffRoleLabels[role]}s</dt>
                <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
                  <Link
                    aria-label={`${plural(staff.filter((member) => member.role === role).length, staffRoleLabels[role].toLowerCase())}. Show them.`}
                    className="rounded hover:text-pine"
                    to={`/admin/staff?role=${role}`}
                  >
                    {staff.filter((member) => member.role === role).length}
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted">
            {disabled === 0 ? 'Every account is enabled.' : `${plural(disabled, 'account')} disabled.`}
          </p>
        </>
      )}
    </section>
  );
}

function ActivityList({ actions, staff }: { actions: AdminAction[]; staff: StaffMember[] }) {
  const names = useMemo(
    () => new Map([...recordedNames(actions), ...staff.map((member) => [member.uid, member.fullName] as const)]),
    [actions, staff],
  );
  const now = new Date();

  if (actions.length === 0) {
    return (
      <p className="mt-4 leading-7 text-muted">
        No admin actions yet. Every account change and support request change shows up here as it happens.
      </p>
    );
  }

  return (
    <ol aria-label="Recent admin actions" className="mt-4 divide-y divide-line/70">
      {actions.map((action) => {
        const { actor, summary } = describeAdminAction(action, (uid) => names.get(uid) ?? null);

        return (
          <li className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3" key={action.id}>
            <p className="min-w-0 leading-6">
              <span className="font-semibold">{actor}</span> {summary}
            </p>
            <time
              className="shrink-0 text-sm whitespace-nowrap text-muted"
              dateTime={action.createdAt?.toISOString()}
              title={formatDateTime(action.createdAt)}
            >
              {formatRelative(action.createdAt, now)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}

export function AdminDashboardPage() {
  const { state: staffState } = useStaff();
  const activity = useRecentActivity();
  const requests = useSupportRequests();
  const reviews = useReviews();
  const summary =
    requests.status === 'ready' && reviews.status === 'ready' ? inboxSummary(requests.items, reviews.items) : null;

  // The tiles need both lists: one that failed says so, otherwise they load.
  const failed = [requests, reviews].some((state) => state.status === 'denied' || state.status === 'error');
  const loading = summary === null && !failed;

  function waiting(state: { status: string }, what: string) {
    return state.status === 'loading' ? `Loading the ${what}.` : `The ${what} could not be loaded.`;
  }

  return (
    <AdminPage
      actions={
        <Link className="btn btn-primary" to="/admin/staff?new">
          New staff member
        </Link>
      }
      description="Who has access, what borrowers are telling us, and what admins changed lately."
      title="Dashboard"
    >
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <div className="md:col-span-2 lg:col-span-1">
          <StaffSummary state={staffState} />
        </div>
        <StatTile
          detail={
            summary
              ? `${plural(summary.closed, 'closed request')} so far.`
              : waiting(requests.status === 'ready' ? reviews : requests, 'support requests')
          }
          label="Open support requests"
          loading={loading}
          to="/admin/inbox"
          value={summary?.open ?? null}
        />
        <StatTile
          detail={
            summary
              ? summary.reviews === 0
                ? 'No reviews yet.'
                : `Out of 5, from ${plural(summary.reviews, 'review')}.`
              : waiting(reviews.status === 'ready' ? requests : reviews, 'reviews')
          }
          label="Average review"
          loading={loading}
          to="/admin/inbox?tab=reviews"
          value={summary?.averageRating == null ? (summary ? '—' : null) : formatRating(summary.averageRating)}
        />
      </div>

      <section aria-labelledby="dashboard-activity" className="card mt-5">
        <h2 className="card-title" id="dashboard-activity">
          Recent activity
        </h2>
        {activity.status === 'ready' ? (
          <ActivityList actions={activity.items} staff={staffState.status === 'ready' ? staffState.staff : []} />
        ) : (
          <div className="mt-4">
            <LiveStatus
              skeleton={
                <div className="divide-y divide-line/70">
                  {['w-2/3', 'w-1/2', 'w-3/5', 'w-5/12'].map((width) => (
                    <div className="flex items-baseline justify-between gap-6 py-3" key={width}>
                      <Skeleton className={`h-5 ${width}`} />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  ))}
                </div>
              }
              state={activity}
              what="recent activity"
            />
          </div>
        )}
      </section>
    </AdminPage>
  );
}
