import { matchesSearch } from '../../../components/admin/SearchField';
import { APPLICATION_STATUSES } from '../../../services/clientsService';
import type { CommitteeRun } from '../../../services/committeeService';
import type { LoanFileApplication, LoanNote } from '../../../services/loanFileService';
import type { DirectoryUser } from '../../../services/userDirectoryService';
import { loanTypeLabel } from '../../../utils/formatters';

// The business view's figures and filters, as pure functions of the live lists.

export const DECISIONS = ['approved', 'declined', 'undecided'] as const;
export type Decision = (typeof DECISIONS)[number];

export const RUN_STATUSES = ['complete', 'failed', 'running'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const runStatusLabels: Record<RunStatus, string> = { complete: 'Complete', failed: 'Failed', running: 'Running' };

// One bar of a breakdown: `key` is the value the list behind it filters on.
export interface Tally {
  key: string;
  label: string;
  count: number;
}

function countBy<T>(items: readonly T[], key: (item: T) => string | null) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

// A stored outcome outside the two agreed values is not a decision anyone can count.
export function decisionOf(application: Pick<LoanFileApplication, 'decision'>): Decision {
  const outcome = application.decision?.outcome;
  return outcome === 'approved' || outcome === 'declined' ? outcome : 'undecided';
}

// When the application was opened: created, or submitted on a document with no creation time.
export function openedAt(application: Pick<LoanFileApplication, 'createdAt' | 'submittedAt'>) {
  return application.createdAt ?? application.submittedAt;
}

// Every agreed status in pipeline order, zeros included, then any other stored status.
export function tallyStatuses(applications: readonly LoanFileApplication[]): Tally[] {
  const counts = countBy(applications, (application) => application.status);
  const known: readonly string[] = APPLICATION_STATUSES;
  const other = [...counts.keys()].filter((status) => !known.includes(status)).sort();

  return [...known, ...other].map((status) => ({ key: status, label: status, count: counts.get(status) ?? 0 }));
}

// Mortgages and HELOCs, then any other stored type. Applications with no type come last, keyed ''.
export function tallyLoanTypes(applications: readonly LoanFileApplication[]): Tally[] {
  const counts = countBy(applications, (application) => application.loanType ?? '');
  const other = [...counts.keys()].filter((type) => type !== '' && type !== 'mortgage' && type !== 'heloc').sort();
  const tallies = ['mortgage', 'heloc', ...other].map((type) => ({
    key: type,
    label: loanTypeLabel(type) ?? type,
    count: counts.get(type) ?? 0,
  }));
  const missing = counts.get('') ?? 0;

  return missing === 0 ? tallies : [...tallies, { key: '', label: 'Type not recorded', count: missing }];
}

export interface MonthTally extends Tally {
  // The month written out, as in "June 2026".
  name: string;
  // The first and last day, as the applications list's date filter takes them.
  from: string;
  to: string;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

// A local calendar day as YYYY-MM-DD: the portal is used in Ireland, so months follow the local clock.
export function isoDay(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const shortMonth = new Intl.DateTimeFormat('en-IE', { month: 'short' });
const longMonth = new Intl.DateTimeFormat('en-IE', { month: 'long', year: 'numeric' });

// Applications opened in each of the last `months` calendar months, oldest first, this month last.
export function tallyMonths(applications: readonly LoanFileApplication[], now: Date, months = 6): MonthTally[] {
  const buckets = Array.from({ length: months }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1 - index), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return {
      key: isoDay(start).slice(0, 7),
      label: shortMonth.format(start),
      name: longMonth.format(start),
      from: isoDay(start),
      to: isoDay(end),
      count: 0,
    };
  });
  const byMonth = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const application of applications) {
    const opened = openedAt(application);
    const bucket = opened ? byMonth.get(isoDay(opened).slice(0, 7)) : undefined;
    if (bucket) bucket.count += 1;
  }

  return buckets;
}

export interface DecisionRates {
  approved: number;
  declined: number;
  decided: number;
  // Shares of the decided applications, from 0 to 1; null while nothing has been decided.
  approvalRate: number | null;
  declineRate: number | null;
}

export function decisionRates(applications: readonly LoanFileApplication[]): DecisionRates {
  const counts = countBy(applications, decisionOf);
  const approved = counts.get('approved') ?? 0;
  const declined = counts.get('declined') ?? 0;
  const decided = approved + declined;

  return {
    approved,
    declined,
    decided,
    approvalRate: decided === 0 ? null : approved / decided,
    declineRate: decided === 0 ? null : declined / decided,
  };
}

// Runs by status. A run with no readable status is in none of the three.
export function tallyRuns(runs: readonly CommitteeRun[]): Tally[] {
  const counts = countBy(runs, (run) => run.status);
  return RUN_STATUSES.map((status) => ({ key: status, label: runStatusLabels[status], count: counts.get(status) ?? 0 }));
}

// The chain side of an application: its loan note (open until al-core closes it) and the audit registry's
// transaction. A note whose close record cannot be read is minted, but neither open nor closed.
export const LEDGER_FILTERS = ['minted', 'open', 'closed', 'recorded'] as const;
export type LedgerFilter = (typeof LEDGER_FILTERS)[number];

type Ledger = Pick<LoanFileApplication, 'loanNote' | 'auditTxHash'>;

const ledger: Record<LedgerFilter, { label: string; test(application: Ledger): boolean }> = {
  minted: { label: 'Minted', test: ({ loanNote }) => loanNote !== null },
  open: { label: 'Open', test: ({ loanNote }) => loanNote !== null && loanNote.closedAt === null && !loanNote.closeUnreadable },
  closed: { label: 'Closed', test: ({ loanNote }) => loanNote?.closedAt != null },
  recorded: { label: 'Audit hash recorded', test: ({ auditTxHash }) => auditTxHash !== null },
};

export const ledgerFilterLabels = Object.fromEntries(
  LEDGER_FILTERS.map((filter) => [filter, ledger[filter].label]),
) as Record<LedgerFilter, string>;

export function matchesLedger(application: Ledger, filter: LedgerFilter) {
  return ledger[filter].test(application);
}

export interface Mint {
  application: LoanFileApplication;
  note: LoanNote;
}

export interface ChainFigures extends Record<LedgerFilter, number> {
  // The latest mints, newest first.
  recent: Mint[];
}

export function chainFigures(applications: readonly LoanFileApplication[], recent = 5): ChainFigures {
  const count = (filter: LedgerFilter) => applications.filter((application) => matchesLedger(application, filter)).length;
  const mints = applications
    .flatMap((application) => (application.loanNote ? [{ application, note: application.loanNote }] : []))
    .sort((a, b) => b.note.mintedAt.getTime() - a.note.mintedAt.getTime());

  return {
    minted: count('minted'),
    open: count('open'),
    closed: count('closed'),
    recorded: count('recorded'),
    recent: mints.slice(0, recent),
  };
}

export const FILTER_KEYS = ['status', 'loanType', 'broker', 'decision', 'from', 'to', 'q'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export interface ApplicationFilters {
  q: string;
  status: string | null;
  loanType: string | null;
  broker: string | null;
  decision: Decision | null;
  // Inclusive local days, YYYY-MM-DD, matched against when the application was opened.
  from: string | null;
  to: string | null;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// The start of a YYYY-MM-DD day in local time, `offset` days later; null for a day that does not exist.
function dayStart(value: string, offset = 0) {
  const [, year, month, day] = DAY.exec(value)!.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day ? new Date(year, month - 1, day + offset) : null;
}

// The list's filters live in the URL, so the overview can link to a filtered list and back works.
// A value that cannot be one of the filter's choices is ignored rather than matching nothing.
export function readApplicationFilters(params: URLSearchParams): ApplicationFilters {
  const text = (name: FilterKey) => params.get(name)?.trim() || null;
  const day = (name: FilterKey) => {
    const value = text(name);
    return value !== null && DAY.test(value) && dayStart(value) !== null ? value : null;
  };

  return {
    q: params.get('q') ?? '',
    status: text('status'),
    loanType: text('loanType'),
    broker: text('broker'),
    decision: DECISIONS.find((decision) => decision === params.get('decision')) ?? null,
    from: day('from'),
    to: day('to'),
  };
}

export function filterApplications(applications: readonly LoanFileApplication[], filters: ApplicationFilters) {
  const from = filters.from === null ? null : dayStart(filters.from);
  const until = filters.to === null ? null : dayStart(filters.to, 1);

  return applications.filter((application) => {
    const opened = openedAt(application);

    return (
      (filters.status === null || application.status === filters.status) &&
      (filters.loanType === null || application.loanType === filters.loanType) &&
      (filters.broker === null || application.brokerId === filters.broker) &&
      (filters.decision === null || decisionOf(application) === filters.decision) &&
      (from === null || (opened !== null && opened >= from)) &&
      (until === null || (opened !== null && opened < until)) &&
      matchesSearch(filters.q, application.borrowerName, application.id, application.borrowerId)
    );
  });
}

export function applicationsHref(filters: Partial<Record<FilterKey, string>> = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  return `/admin/business/applications${query ? `?${query}` : ''}`;
}

export const USER_ROLES = ['borrower', 'broker', 'underwriter', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserWork {
  // A broker's clients: the borrowers who chose them. Null for anyone who is not a broker.
  clients: number | null;
  // A broker's applications, or a borrower's own. Null for staff who own none.
  applications: number | null;
}

export function userWork(users: readonly DirectoryUser[], applications: readonly LoanFileApplication[]) {
  const clients = countBy(
    users.filter((user) => user.role === 'borrower'),
    (user) => user.brokerId,
  );
  const byBroker = countBy(applications, (application) => application.brokerId);
  const byBorrower = countBy(applications, (application) => application.borrowerId);

  return (user: DirectoryUser): UserWork =>
    user.role === 'broker'
      ? { clients: clients.get(user.uid) ?? 0, applications: byBroker.get(user.uid) ?? 0 }
      : user.role === 'borrower'
        ? { clients: null, applications: byBorrower.get(user.uid) ?? 0 }
        : { clients: null, applications: null };
}
