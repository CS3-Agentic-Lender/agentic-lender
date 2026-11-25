import { useDeferredValue, useMemo } from 'react';
import { Link } from 'react-router';
import { DataTable, type Column } from '../../../components/admin/DataTable';
import { SearchField, matchesSearch } from '../../../components/admin/SearchField';
import { SegmentedFilter } from '../../../components/admin/SegmentedFilter';
import { ListSkeleton, LiveStatus, StatusPanel } from '../../../components/admin/StatusPanel';
import { useApplications, useUsers } from '../../../context/AdminDataContext';
import { directoryNames, type DirectoryUser } from '../../../services/userDirectoryService';
import { formatDate } from '../../../utils/formatters';
import { BusinessPage, NONE, plural, useUrlFilters } from './BusinessPage';
import { USER_ROLES, applicationsHref, userWork, type UserRole, type UserWork } from './figures';

type RoleFilter = UserRole | 'all';

const roleLabels: Record<UserRole, string> = {
  borrower: 'Borrower',
  broker: 'Broker',
  underwriter: 'Underwriter',
  admin: 'Admin',
};

const filterLabels: Record<RoleFilter, string> = {
  all: 'All',
  borrower: 'Borrowers',
  broker: 'Brokers',
  underwriter: 'Underwriters',
  admin: 'Admins',
};

// The staff page's role badges, with borrowers in the quietest style.
const roleBadgeClass: Record<UserRole, string> = {
  borrower: 'border border-line text-neutral-text',
  broker: 'bg-tint text-pine',
  underwriter: 'bg-neutral text-neutral-text',
  admin: 'border border-pine text-pine',
};

function isRole(value: string | null): value is UserRole {
  return USER_ROLES.some((role) => role === value);
}

function RoleBadge({ role }: { role: string | null }) {
  return isRole(role) ? (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${roleBadgeClass[role]}`}>
      {roleLabels[role]}
    </span>
  ) : (
    <span className="text-sm text-muted">{role ?? 'No role'}</span>
  );
}

interface UserRow {
  user: DirectoryUser;
  name: string;
  brokerName: string | null;
  // Null while the applications are not readable: the counts are then unknown, not zero.
  work: UserWork | null;
}

function ApplicationsCell({ row }: { row: UserRow }) {
  const count = row.work?.applications ?? null;

  if (count === null) {
    return NONE;
  }

  const broker = row.user.role === 'broker';
  const label = `${plural(count, 'application')} ${broker ? 'through' : 'from'} ${row.name}. Show them.`;

  return (
    <Link
      aria-label={label}
      className="font-semibold tabular-nums text-pine underline-offset-4 hover:underline"
      to={applicationsHref(broker ? { broker: row.user.uid } : { q: row.user.uid })}
    >
      {count}
    </Link>
  );
}

const userColumns: Column<UserRow>[] = [
  {
    id: 'name',
    header: 'Name',
    primary: true,
    sortValue: (row) => row.name,
    cell: (row) => (
      <div className="min-w-0">
        <p className="font-semibold">{row.name}</p>
        {row.user.email && row.user.email !== row.name ? <p className="text-sm break-all text-muted">{row.user.email}</p> : null}
      </div>
    ),
  },
  { id: 'role', header: 'Role', sortValue: (row) => row.user.role, cell: (row) => <RoleBadge role={row.user.role} /> },
  { id: 'firm', header: 'Firm', sortValue: (row) => row.user.firm, cell: (row) => row.user.firm ?? NONE },
  { id: 'broker', header: 'Broker', sortValue: (row) => row.brokerName, cell: (row) => row.brokerName ?? NONE },
  {
    id: 'clients',
    header: 'Clients',
    sortValue: (row) => row.work?.clients ?? null,
    cell: (row) => (row.work?.clients == null ? NONE : <span className="tabular-nums">{row.work.clients}</span>),
  },
  {
    id: 'applications',
    header: 'Applications',
    sortValue: (row) => row.work?.applications ?? null,
    cell: (row) => <ApplicationsCell row={row} />,
  },
  {
    id: 'joined',
    header: 'Joined',
    sortValue: (row) => row.user.createdAt?.getTime() ?? null,
    cell: (row) => <span className="whitespace-nowrap">{formatDate(row.user.createdAt)}</span>,
  },
];

export function UsersPage() {
  const users = useUsers();
  const applications = useApplications();
  const { params, setFilter } = useUrlFilters();
  const role: RoleFilter = isRole(params.get('role')) ? (params.get('role') as UserRole) : 'all';
  const search = params.get('q') ?? '';
  const query = useDeferredValue(search);

  const rows = useMemo<UserRow[]>(() => {
    if (users.status !== 'ready') return [];
    const names = directoryNames(users.items);
    const work = applications.status === 'ready' ? userWork(users.items, applications.items) : null;

    return users.items.map((user) => ({
      user,
      name: user.fullName ?? user.email ?? user.uid,
      // A borrower's broker by name, else by ID, so a broker missing from the directory still shows.
      brokerName: user.brokerId ? names(user.brokerId) ?? user.brokerId : null,
      work: work ? work(user) : null,
    }));
  }, [users, applications]);

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          (role === 'all' || row.user.role === role) &&
          matchesSearch(query, row.name, row.user.email, row.user.firm, row.brokerName),
      ),
    [rows, role, query],
  );

  return (
    <BusinessPage
      description="Borrowers, brokers, underwriters and admins, with each broker's clients and applications. Staff accounts are managed on the Staff page."
      title="Users"
    >
      {users.status !== 'ready' ? (
        <LiveStatus
          skeleton={<ListSkeleton columns={userColumns.length} segments={USER_ROLES.length + 1} />}
          state={users}
          what="users"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <SearchField
              label="Search users"
              onChange={(value) => setFilter('q', value)}
              placeholder="Name, email, firm or broker"
              value={search}
            />
            <SegmentedFilter
              legend="Role"
              onChange={(next) => setFilter('role', next === 'all' ? null : next)}
              options={(['all', ...USER_ROLES] as const).map((value) => ({
                value,
                label: filterLabels[value],
                count: value === 'all' ? rows.length : rows.filter((row) => row.user.role === value).length,
              }))}
              value={role}
            />
          </div>
          <p className="mt-5 text-sm text-muted" role="status">
            {visible.length === rows.length
              ? `Showing all ${plural(rows.length, 'user')}.`
              : `Showing ${visible.length} of ${plural(rows.length, 'user')}.`}
            {applications.status === 'ready' ? null : ' Application counts are not available.'}
          </p>
          <div className="mt-4">
            <DataTable
              caption="Users"
              columns={userColumns}
              defaultSort={{ column: 'name', direction: 'asc' }}
              empty={
                <StatusPanel
                  detail={
                    rows.length === 0
                      ? 'Users appear here as borrowers sign up and staff accounts are added.'
                      : 'Nobody matches this search and role. Clear the search or pick another role.'
                  }
                  heading={rows.length === 0 ? 'No users yet' : 'No matches'}
                />
              }
              rowKey={(row) => row.user.uid}
              rows={visible}
            />
          </div>
        </>
      )}
    </BusinessPage>
  );
}
