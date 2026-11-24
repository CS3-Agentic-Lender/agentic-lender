import { useDeferredValue, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AdminPage } from '../../components/admin/AdminPage';
import { DataTable, type Column } from '../../components/admin/DataTable';
import { SearchField, fieldClass, matchesSearch } from '../../components/admin/SearchField';
import { SegmentedFilter } from '../../components/admin/SegmentedFilter';
import { ListSkeleton, LoadingPanel, StatusPanel } from '../../components/admin/StatusPanel';
import { useAuth } from '../../context/AuthContext';
import { useStaff } from '../../context/StaffContext';
import { STAFF_ROLES, staffRoleLabels, type StaffMember, type StaffRole } from '../../services/staffService';
import { formatDate } from '../../utils/formatters';
import { StaffDialogHost, type StaffDialog } from './StaffDialogs';

type RoleFilter = StaffRole | 'all';
type StatusFilter = 'all' | 'enabled' | 'disabled';

const roleFilterLabels: Record<RoleFilter, string> = {
  all: 'All',
  admin: 'Admins',
  broker: 'Brokers',
  underwriter: 'Underwriters',
};

function readRoleFilter(value: string | null): RoleFilter {
  return STAFF_ROLES.find((role) => role === value) ?? 'all';
}

const roleBadgeClass: Record<StaffRole, string> = {
  admin: 'border border-pine text-pine',
  broker: 'bg-tint text-pine',
  underwriter: 'bg-neutral text-neutral-text',
};

function RoleBadge({ role }: { role: StaffRole }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${roleBadgeClass[role]}`}>
      {staffRoleLabels[role]}
    </span>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${
        enabled ? 'bg-success-soft text-success' : 'bg-danger-soft text-error'
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-success' : 'bg-error'}`} />
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

const actionClass =
  'inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold text-pine transition-colors hover:bg-tint';
const deleteClass =
  'inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold text-error transition-colors hover:bg-danger-soft';

function StaffActions({ member, onOpen }: { member: StaffMember; onOpen(dialog: StaffDialog): void }) {
  if (member.role === 'admin') {
    return <span className="text-sm text-muted">Managed by script</span>;
  }

  return (
    <div className="flex flex-wrap justify-end gap-1 md:justify-start">
      <button
        aria-label={`${member.enabled ? 'Disable' : 'Enable'} ${member.fullName}`}
        className={actionClass}
        onClick={() => onOpen({ kind: member.enabled ? 'disable' : 'enable', member })}
        type="button"
      >
        {member.enabled ? 'Disable' : 'Enable'}
      </button>
      <button
        aria-label={`Change ${member.fullName}'s role`}
        className={actionClass}
        onClick={() => onOpen({ kind: 'role', member })}
        type="button"
      >
        Change role
      </button>
      <button
        aria-label={`Delete ${member.fullName}`}
        className={deleteClass}
        onClick={() => onOpen({ kind: 'delete', member })}
        type="button"
      >
        Delete
      </button>
    </div>
  );
}

function staffColumns(currentUid: string | null, onOpen: (dialog: StaffDialog) => void): Column<StaffMember>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      primary: true,
      sortValue: (member) => member.fullName,
      cell: (member) => (
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {member.fullName}
            {member.uid === currentUid ? (
              <span className="rounded-full bg-pine px-2 py-0.5 text-xs font-medium text-surface">You</span>
            ) : null}
          </p>
          <p className="text-sm break-all text-muted">{member.email}</p>
        </div>
      ),
    },
    { id: 'role', header: 'Role', sortValue: (member) => member.role, cell: (member) => <RoleBadge role={member.role} /> },
    {
      id: 'firm',
      header: 'Firm',
      sortValue: (member) => member.firm,
      cell: (member) => member.firm ?? <span className="text-muted">—</span>,
    },
    {
      id: 'phone',
      header: 'Phone',
      cell: (member) => <span className="font-mono whitespace-nowrap">{member.phone ?? '—'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (member) => (member.enabled ? 0 : 1),
      cell: (member) => <EnabledBadge enabled={member.enabled} />,
    },
    {
      id: 'created',
      header: 'Created',
      sortValue: (member) => member.createdAt?.getTime() ?? null,
      cell: (member) => <span className="whitespace-nowrap">{formatDate(member.createdAt)}</span>,
    },
    { id: 'actions', header: 'Actions', cell: (member) => <StaffActions member={member} onOpen={onOpen} /> },
  ];
}

function countLabel(count: number) {
  return count === 1 ? '1 staff account' : `${count} staff accounts`;
}

export function StaffPage() {
  const { state, reload } = useStaff();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search);
  const [status, setStatus] = useState<StatusFilter>('all');
  const role = readRoleFilter(params.get('role'));
  // ?new opens the create form, so the dashboard's shortcut lands straight in it.
  const [dialog, setDialog] = useState<StaffDialog | null>(params.has('new') ? { kind: 'create' } : null);

  const staff = state.status === 'ready' ? state.staff : [];
  const columns = useMemo(() => staffColumns(user?.uid ?? null, setDialog), [user?.uid]);
  const visible = useMemo(
    () =>
      staff.filter(
        (member) =>
          (role === 'all' || member.role === role) &&
          (status === 'all' || member.enabled === (status === 'enabled')) &&
          matchesSearch(query, member.fullName, member.email, member.firm, member.phone),
      ),
    [staff, role, status, query],
  );

  function setRole(next: RoleFilter) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === 'all') updated.delete('role');
        else updated.set('role', next);
        return updated;
      },
      { replace: true },
    );
  }

  function changeDialog(next: StaffDialog | null) {
    setDialog(next);
    if (next === null && params.has('new')) {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          updated.delete('new');
          return updated;
        },
        { replace: true },
      );
    }
  }

  return (
    <AdminPage
      actions={
        <button className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })} type="button">
          New staff member
        </button>
      }
      description="Brokers and underwriters you can add, disable, move between roles or delete. Admin accounts are listed but made only by script."
      title="Staff"
    >
      {state.status === 'loading' ? (
        <LoadingPanel label="Loading the staff accounts">
          <ListSkeleton columns={columns.length} segments={4} />
        </LoadingPanel>
      ) : state.status === 'error' ? (
        <StatusPanel
          action={
            <button className="btn btn-secondary" onClick={reload} type="button">
              Try again
            </button>
          }
          detail={state.message}
          heading="The staff list could not be loaded"
          tone="error"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <SearchField label="Search staff" onChange={setSearch} placeholder="Name, email, firm or phone" value={search} />
            <SegmentedFilter
              legend="Role"
              onChange={setRole}
              options={(['all', 'broker', 'underwriter', 'admin'] as const).map((value) => ({
                value,
                label: roleFilterLabels[value],
                count: value === 'all' ? staff.length : staff.filter((member) => member.role === value).length,
              }))}
              value={role}
            />
            <div>
              <label className="mb-2 block text-sm font-semibold" htmlFor="staff-status">
                Status
              </label>
              <select
                className={`${fieldClass} cursor-pointer`}
                id="staff-status"
                onChange={(event) => setStatus(event.target.value as StatusFilter)}
                value={status}
              >
                <option value="all">Any status</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          </div>
          <p className="mt-5 text-sm text-muted" role="status">
            {visible.length === staff.length
              ? `Showing all ${countLabel(staff.length)}.`
              : `Showing ${visible.length} of ${countLabel(staff.length)}.`}
          </p>
          <div className="mt-4">
            <DataTable
              caption="Staff accounts"
              columns={columns}
              empty={
                <StatusPanel
                  detail={
                    staff.length === 0
                      ? 'Add the first broker or underwriter with "New staff member".'
                      : 'No staff account matches these filters. Clear the search or pick another role.'
                  }
                  heading={staff.length === 0 ? 'No staff accounts yet' : 'No matches'}
                />
              }
              rowKey={(member) => member.uid}
              rows={visible}
            />
          </div>
        </>
      )}
      <StaffDialogHost dialog={dialog} onChange={changeDialog} />
    </AdminPage>
  );
}
