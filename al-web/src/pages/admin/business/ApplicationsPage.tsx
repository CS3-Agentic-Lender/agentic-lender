import { useDeferredValue, useId, useMemo } from 'react';
import { DataTable, type Column } from '../../../components/admin/DataTable';
import { SearchField, fieldClass } from '../../../components/admin/SearchField';
import { ListSkeleton, LiveStatus, StatusPanel } from '../../../components/admin/StatusPanel';
import { StatusBadge } from '../../../components/StatusBadge';
import { useApplications, useUsers } from '../../../context/AdminDataContext';
import { APPLICATION_STATUSES } from '../../../services/clientsService';
import type { LoanFileApplication } from '../../../services/loanFileService';
import { directoryNames } from '../../../services/userDirectoryService';
import { formatDate, formatEuro, loanTypeLabel } from '../../../utils/formatters';
import { BusinessPage, NONE, RowLink, plural, useUrlFilters } from './BusinessPage';
import { FILTER_KEYS, filterApplications, openedAt, readApplicationFilters, type FilterKey } from './figures';

interface Option {
  value: string;
  label: string;
}

function SelectField({ label, value, options, anyLabel, onChange }: {
  label: string;
  value: string | null;
  options: readonly Option[];
  anyLabel: string;
  onChange(value: string | null): void;
}) {
  const id = useId();

  return (
    <div className="min-w-0">
      <label className="mb-2 block text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <select
        className={`${fieldClass} cursor-pointer`}
        id={id}
        onChange={(event) => onChange(event.target.value || null)}
        value={value ?? ''}
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string | null; onChange(value: string | null): void }) {
  const id = useId();

  return (
    <div className="min-w-0">
      <label className="mb-2 block text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <input
        className={`${fieldClass} min-w-0 cursor-pointer`}
        id={id}
        onChange={(event) => onChange(event.target.value || null)}
        type="date"
        value={value ?? ''}
      />
    </div>
  );
}

const decisionOptions: Option[] = [
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'undecided', label: 'Not decided' },
];

function columns(brokerName: (uid: string | null) => string | null): Column<LoanFileApplication>[] {
  return [
    {
      id: 'borrower',
      header: 'Borrower',
      primary: true,
      sortValue: (application) => application.borrowerName ?? null,
      cell: (application) => (
        <div className="min-w-0">
          <RowLink to={`/admin/applications/${encodeURIComponent(application.id)}`}>
            {application.borrowerName ?? 'Name not recorded'}
          </RowLink>
          <p className="font-mono text-sm break-all text-muted">{application.id}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (application) => application.status,
      cell: (application) => <StatusBadge status={application.status} />,
    },
    {
      id: 'type',
      header: 'Loan type',
      sortValue: (application) => application.loanType,
      cell: (application) => loanTypeLabel(application.loanType) ?? NONE,
    },
    {
      id: 'amount',
      header: 'Amount',
      sortValue: (application) => application.loanAmountEur,
      cell: (application) => <span className="tabular-nums whitespace-nowrap">{formatEuro(application.loanAmountEur)}</span>,
    },
    {
      id: 'broker',
      header: 'Broker',
      sortValue: (application) => brokerName(application.brokerId),
      cell: (application) => brokerName(application.brokerId) ?? NONE,
    },
    {
      id: 'opened',
      header: 'Opened',
      sortValue: (application) => openedAt(application)?.getTime() ?? null,
      cell: (application) => <span className="whitespace-nowrap">{formatDate(openedAt(application))}</span>,
    },
  ];
}

export function ApplicationsPage() {
  const applications = useApplications();
  const users = useUsers();
  const { params, setFilter, clearFilters } = useUrlFilters();
  const filters = readApplicationFilters(params);
  const query = useDeferredValue(filters.q);
  const all = applications.status === 'ready' ? applications.items : [];
  const names = useMemo(() => directoryNames(users.status === 'ready' ? users.items : []), [users]);

  // A broker named by the directory, else by the ID on the application, so a filter never shows a blank.
  const brokerName = useMemo(() => (uid: string | null) => (uid ? names(uid) ?? uid : null), [names]);
  const tableColumns = useMemo(() => columns(brokerName), [brokerName]);
  const { status, loanType, broker, decision, from, to } = filters;
  const visible = useMemo(
    () => filterApplications(all, { status, loanType, broker, decision, from, to, q: query }),
    [all, status, loanType, broker, decision, from, to, query],
  );

  const options = useMemo(() => {
    const distinct = (values: Array<string | null>) => [...new Set(values.filter((value) => value !== null))];
    const statuses = distinct([...APPLICATION_STATUSES, ...all.map((application) => application.status)]);
    const types = distinct(['mortgage', 'heloc', ...all.map((application) => application.loanType)]);
    const brokers = distinct([
      ...(users.status === 'ready' ? users.items.filter((user) => user.role === 'broker').map((user) => user.uid) : []),
      ...all.map((application) => application.brokerId),
    ]);

    return {
      statuses: statuses.map((value) => ({ value, label: value })),
      types: types.map((value) => ({ value, label: loanTypeLabel(value) ?? value })),
      brokers: brokers
        .map((value) => ({ value, label: brokerName(value) ?? value }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [all, users, brokerName]);

  const filtered = FILTER_KEYS.some((key) => params.get(key));
  const set = (key: FilterKey) => (value: string | null) => setFilter(key, value);

  return (
    <BusinessPage
      description="Every application, whoever it belongs to. Filter, search or sort it, and open one to read its file."
      title="Applications"
    >
      {applications.status !== 'ready' ? (
        <LiveStatus
          skeleton={<ListSkeleton columns={tableColumns.length} fields={6} />}
          state={applications}
          what="applications"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SearchField
              label="Search applications"
              onChange={(value) => setFilter('q', value)}
              placeholder="Borrower name or ID"
              value={filters.q}
            />
            {filtered ? (
              <button className="btn btn-secondary" onClick={clearFilters} type="button">
                Clear filters
              </button>
            ) : null}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <SelectField anyLabel="Any status" label="Status" onChange={set('status')} options={options.statuses} value={status} />
            <SelectField anyLabel="Any type" label="Loan type" onChange={set('loanType')} options={options.types} value={loanType} />
            <SelectField anyLabel="Any broker" label="Broker" onChange={set('broker')} options={options.brokers} value={broker} />
            <SelectField anyLabel="Any decision" label="Decision" onChange={set('decision')} options={decisionOptions} value={decision} />
            <DateField label="Opened from" onChange={set('from')} value={from} />
            <DateField label="Opened to" onChange={set('to')} value={to} />
          </div>
          <p className="mt-5 text-sm text-muted" role="status">
            {visible.length === all.length
              ? `Showing all ${plural(all.length, 'application')}.`
              : `Showing ${visible.length} of ${plural(all.length, 'application')}.`}
          </p>
          <div className="mt-4">
            <DataTable
              caption="Applications"
              columns={tableColumns}
              defaultSort={{ column: 'opened', direction: 'desc' }}
              empty={
                <StatusPanel
                  detail={
                    all.length === 0
                      ? 'Applications appear here as borrowers start them in the app.'
                      : 'No application matches these filters. Clear them or pick others.'
                  }
                  heading={all.length === 0 ? 'No applications yet' : 'No matches'}
                />
              }
              rowHref={(application) => `/admin/applications/${encodeURIComponent(application.id)}`}
              rowKey={(application) => application.id}
              rows={visible}
            />
          </div>
        </>
      )}
    </BusinessPage>
  );
}
