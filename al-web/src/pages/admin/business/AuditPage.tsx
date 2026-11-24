import { useDeferredValue, useMemo } from 'react';
import { DataTable, type Column } from '../../../components/admin/DataTable';
import { SearchField, matchesSearch } from '../../../components/admin/SearchField';
import { ListSkeleton, LiveStatus, StatusPanel } from '../../../components/admin/StatusPanel';
import { SegmentedFilter } from '../../../components/admin/SegmentedFilter';
import { explorerTxUrl } from '../../../components/lending/LoanNotePanel';
import { ToneBadge } from '../../../components/StatusBadge';
import { useApplications, useUsers } from '../../../context/AdminDataContext';
import type { LoanFileApplication } from '../../../services/loanFileService';
import { directoryNames } from '../../../services/userDirectoryService';
import { formatDateTime } from '../../../utils/formatters';
import { BusinessPage, NONE, RowLink, plural, useUrlFilters } from './BusinessPage';
import { ChainHash } from './ChainHash';
import { LEDGER_FILTERS, decisionOf, ledgerFilterLabels, matchesLedger, type LedgerFilter } from './figures';

interface AuditRow {
  application: LoanFileApplication;
  // The underwriter by name, else by ID when the directory does not know them.
  decidedBy: string | null;
}


const auditColumns: Column<AuditRow>[] = [
  {
    id: 'application',
    header: 'Application',
    primary: true,
    sortValue: ({ application }) => application.borrowerName ?? application.id,
    cell: ({ application }) => (
      <div className="min-w-0">
        <RowLink to={`/admin/applications/${encodeURIComponent(application.id)}`}>
          {application.borrowerName ?? 'Name not recorded'}
        </RowLink>
        <p className="font-mono text-sm break-all text-muted">{application.id}</p>
      </div>
    ),
  },
  {
    id: 'outcome',
    header: 'Outcome',
    sortValue: ({ application }) => decisionOf(application),
    cell: ({ application }) => {
      const outcome = decisionOf(application);
      return outcome === 'undecided' ? (
        <span className="text-sm text-muted">Not recorded</span>
      ) : (
        <ToneBadge tone={outcome === 'approved' ? 'success' : 'danger'}>
          {outcome === 'approved' ? 'Approved' : 'Declined'}
        </ToneBadge>
      );
    },
  },
  { id: 'by', header: 'Decided by', sortValue: (row) => row.decidedBy, cell: (row) => row.decidedBy ?? NONE },
  {
    id: 'decided',
    header: 'Decided',
    sortValue: ({ application }) => application.decision?.decidedAt?.getTime() ?? null,
    cell: ({ application }) => (
      <span className="whitespace-nowrap">{formatDateTime(application.decision?.decidedAt ?? null)}</span>
    ),
  },
  {
    id: 'hash',
    header: 'Audit hash',
    cell: ({ application }) =>
      application.loanNote ? (
        <ChainHash
          hash={application.loanNote.auditHash}
          href={explorerTxUrl(application.loanNote.network, application.auditTxHash)}
          what="Audit hash"
        />
      ) : (
        NONE
      ),
  },
  {
    id: 'mint',
    header: 'Mint transaction',
    cell: ({ application: { loanNote } }) =>
      loanNote ? (
        <ChainHash hash={loanNote.txHash} href={explorerTxUrl(loanNote.network, loanNote.txHash)} what="Mint transaction" />
      ) : (
        <span className="text-sm text-muted">Not minted</span>
      ),
  },
];

export function AuditPage() {
  const applications = useApplications();
  const users = useUsers();
  const { params, setFilter } = useUrlFilters();
  const ledger: LedgerFilter | 'all' = LEDGER_FILTERS.find((value) => value === params.get('note')) ?? 'all';
  const search = params.get('q') ?? '';
  const query = useDeferredValue(search);

  // Each decision and its loan note live on the application (SCHEMA.md), so the trail is read from there.
  const rows = useMemo<AuditRow[]>(() => {
    if (applications.status !== 'ready') return [];
    const names = directoryNames(users.status === 'ready' ? users.items : []);
    return applications.items
      .filter((application) => decisionOf(application) !== 'undecided' || application.loanNote !== null)
      .map((application) => {
        const uid = application.decision?.underwriterId ?? null;
        return { application, decidedBy: uid ? names(uid) ?? uid : null };
      });
  }, [applications, users]);

  const visible = useMemo(
    () =>
      rows.filter(
        ({ application, decidedBy }) =>
          (ledger === 'all' || matchesLedger(application, ledger)) &&
          matchesSearch(query, application.borrowerName, application.id, decidedBy),
      ),
    [rows, ledger, query],
  );

  return (
    <BusinessPage
      description="Every underwriter decision and the loan note minted for it: who decided, when, and the records written to the chain."
      title="Audit"
    >
      {applications.status !== 'ready' ? (
        <LiveStatus
          skeleton={<ListSkeleton columns={auditColumns.length} segments={LEDGER_FILTERS.length + 1} />}
          state={applications}
          what="applications"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <SearchField
              label="Search decisions"
              onChange={(value) => setFilter('q', value)}
              placeholder="Borrower, application or underwriter"
              value={search}
            />
            <SegmentedFilter
              legend="Loan note"
              onChange={(next) => setFilter('note', next === 'all' ? null : next)}
              options={(['all', ...LEDGER_FILTERS] as const).map((value) => ({
                value,
                label: value === 'all' ? 'All' : ledgerFilterLabels[value],
                count:
                  value === 'all'
                    ? rows.length
                    : rows.filter(({ application }) => matchesLedger(application, value)).length,
              }))}
              value={ledger}
            />
          </div>
          <p className="mt-5 text-sm text-muted" role="status">
            {visible.length === rows.length
              ? `Showing all ${plural(rows.length, 'decision')}.`
              : `Showing ${visible.length} of ${plural(rows.length, 'decision')}.`}
          </p>
          <div className="mt-4">
            <DataTable
              caption="Decisions and loan notes"
              columns={auditColumns}
              defaultSort={{ column: 'decided', direction: 'desc' }}
              empty={
                <StatusPanel
                  detail={
                    rows.length === 0
                      ? 'Decisions appear here once an underwriter approves or declines an application.'
                      : 'No decision matches this search and loan note. Clear the search or pick another filter.'
                  }
                  heading={rows.length === 0 ? 'No decisions yet' : 'No matches'}
                />
              }
              rowHref={({ application }) => `/admin/applications/${encodeURIComponent(application.id)}`}
              rowKey={({ application }) => application.id}
              rows={visible}
            />
          </div>
        </>
      )}
    </BusinessPage>
  );
}
