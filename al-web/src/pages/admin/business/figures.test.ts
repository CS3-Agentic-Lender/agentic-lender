import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { businessApplication, committeeRun, directoryUser, seededUsers } from '../../../test/adminHarness';
import {
  applicationsHref,
  chainFigures,
  decisionRates,
  matchesLedger,
  filterApplications,
  readApplicationFilters,
  tallyLoanTypes,
  tallyMonths,
  tallyRuns,
  tallyStatuses,
  userWork,
} from './figures';

// A local time, so month and day boundaries hold in any timezone the tests run in.
function local(year: number, month: number, day: number, hour = 12) {
  return Timestamp.fromDate(new Date(year, month - 1, day, hour));
}

function counts(tallies: { key: string; count: number }[]) {
  return Object.fromEntries(tallies.map(({ key, count }) => [key, count]));
}

describe('business figures', () => {
  it('counts applications by status in pipeline order, zeros included, then any other stored status', () => {
    const tallies = tallyStatuses([
      businessApplication('a', { status: 'Applied' }),
      businessApplication('b', { status: 'Applied' }),
      businessApplication('c', { status: 'Funded' }),
      businessApplication('d', { status: 'Withdrawn' }),
    ]);
    expect(tallies.map(({ key }) => key)).toEqual([
      'Draft',
      'Applied',
      'AI Deliberated',
      'Underwriter Approved',
      'Declined',
      'Funded',
      'Closed',
      'Withdrawn',
    ]);
    expect(counts(tallies)).toMatchObject({ Draft: 0, Applied: 2, Funded: 1, Withdrawn: 1 });
  });

  it('counts applications by loan type and keeps the ones with no type apart', () => {
    const tallies = tallyLoanTypes([
      businessApplication('a', { loanType: 'mortgage' }),
      businessApplication('b', { loanType: 'heloc' }),
      businessApplication('c', { loanType: 'heloc' }),
      businessApplication('d', { loanType: null }),
    ]);
    expect(tallies).toEqual([
      { key: 'mortgage', label: 'Mortgage', count: 1 },
      { key: 'heloc', label: 'HELOC', count: 2 },
      { key: '', label: 'Type not recorded', count: 1 },
    ]);
    expect(tallyLoanTypes([])).toEqual([
      { key: 'mortgage', label: 'Mortgage', count: 0 },
      { key: 'heloc', label: 'HELOC', count: 0 },
    ]);
  });

  it('buckets the last six months by when each application was opened, oldest first', () => {
    const months = tallyMonths(
      [
        businessApplication('may', { createdAt: local(2026, 5, 31, 23) }),
        businessApplication('june-1', { createdAt: local(2026, 6, 1, 0) }),
        businessApplication('june-30', { createdAt: local(2026, 6, 30, 23) }),
        businessApplication('nov', { createdAt: local(2026, 11, 20) }),
        // No creation time stored: the submission stands in for it.
        businessApplication('submitted', { createdAt: null, submittedAt: local(2026, 9, 3) }),
        businessApplication('undated', { createdAt: null }),
      ],
      new Date(2026, 10, 24),
    );
    expect(months.map(({ key, count }) => [key, count])).toEqual([
      ['2026-06', 2],
      ['2026-07', 0],
      ['2026-08', 0],
      ['2026-09', 1],
      ['2026-10', 0],
      ['2026-11', 1],
    ]);
    expect(months[0]).toMatchObject({ label: 'Jun', name: 'June 2026', from: '2026-06-01', to: '2026-06-30' });
    expect(months[5]).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('runs the months across a new year', () => {
    expect(tallyMonths([], new Date(2027, 1, 10)).map(({ key }) => key)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('gives no approval or decline rate while nothing has been decided', () => {
    expect(decisionRates([businessApplication('a'), businessApplication('b', { decision: { outcome: 'maybe' } })])).toEqual({
      approved: 0,
      declined: 0,
      decided: 0,
      approvalRate: null,
      declineRate: null,
    });
  });

  it('rates approvals and declines out of the decided applications only', () => {
    expect(
      decisionRates([
        businessApplication('a', { decision: { outcome: 'approved' } }),
        businessApplication('b', { decision: { outcome: 'approved' } }),
        businessApplication('c', { decision: { outcome: 'approved' } }),
        businessApplication('d', { decision: { outcome: 'declined' } }),
        businessApplication('e'),
      ]),
    ).toEqual({ approved: 3, declined: 1, decided: 4, approvalRate: 0.75, declineRate: 0.25 });
  });

  it('counts committee runs by status', () => {
    expect(
      counts(
        tallyRuns([
          committeeRun('r1', { status: 'complete' }),
          committeeRun('r2', { status: 'complete' }),
          committeeRun('r3', { status: 'failed' }),
          committeeRun('r4', { status: 'running' }),
          committeeRun('r5', { status: 'queued' }),
        ]),
      ),
    ).toEqual({ complete: 2, failed: 1, running: 1 });
  });
});

describe('application filters', () => {
  const applications = [
    businessApplication('LN-1', {
      borrowerName: 'Alice Byrne',
      status: 'Applied',
      loanType: 'mortgage',
      brokerId: 'broker1',
      createdAt: local(2026, 6, 1, 0),
    }),
    businessApplication('LN-2', {
      borrowerName: 'Ben Walsh',
      borrowerId: 'borrower2',
      status: 'Declined',
      loanType: 'heloc',
      brokerId: 'broker2',
      decision: { outcome: 'declined' },
      createdAt: local(2026, 6, 30, 23),
    }),
    businessApplication('LN-3', {
      borrowerName: 'Siobhán Ní Bhriain',
      status: 'Funded',
      loanType: 'mortgage',
      brokerId: 'broker1',
      decision: { outcome: 'approved' },
      createdAt: local(2026, 7, 1, 0),
    }),
  ];

  function ids(query: string) {
    return filterApplications(applications, readApplicationFilters(new URLSearchParams(query))).map(({ id }) => id);
  }

  it('filters by status, loan type, broker and decision', () => {
    expect(ids('status=Declined')).toEqual(['LN-2']);
    expect(ids('loanType=mortgage')).toEqual(['LN-1', 'LN-3']);
    expect(ids('broker=broker1&loanType=mortgage')).toEqual(['LN-1', 'LN-3']);
    expect(ids('decision=approved')).toEqual(['LN-3']);
    expect(ids('decision=undecided')).toEqual(['LN-1']);
  });

  it('filters by the day each application was opened, both ends included', () => {
    expect(ids('from=2026-06-01&to=2026-06-30')).toEqual(['LN-1', 'LN-2']);
    expect(ids('from=2026-07-01')).toEqual(['LN-3']);
    expect(ids('to=2026-06-01')).toEqual(['LN-1']);
  });

  it('searches the borrower name, the application ID and the borrower ID, ignoring accents', () => {
    expect(ids('q=siobhan')).toEqual(['LN-3']);
    expect(ids('q=ln-2')).toEqual(['LN-2']);
    expect(ids('q=borrower2')).toEqual(['LN-2']);
  });

  it('ignores a filter value that cannot be one of its choices', () => {
    expect(readApplicationFilters(new URLSearchParams('decision=maybe&from=2026-02-30&to=soon&status=%20'))).toEqual({
      q: '',
      status: null,
      loanType: null,
      broker: null,
      decision: null,
      from: null,
      to: null,
    });
  });

  it('builds the link to a filtered list', () => {
    expect(applicationsHref()).toBe('/admin/business/applications');
    expect(applicationsHref({ status: 'AI Deliberated', loanType: '' })).toBe(
      '/admin/business/applications?status=AI+Deliberated',
    );
  });
});

describe('user work', () => {
  it("counts each broker's clients and applications, and each borrower's own applications", () => {
    const users = [...seededUsers(), directoryUser({ uid: 'borrower3', brokerId: 'broker1' })];
    const work = userWork(users, [
      businessApplication('LN-1', { brokerId: 'broker1', borrowerId: 'borrower1' }),
      businessApplication('LN-2', { brokerId: 'broker1', borrowerId: 'borrower1' }),
      businessApplication('LN-3', { brokerId: 'broker2', borrowerId: 'borrower2' }),
    ]);
    const of = (uid: string) => work(users.find((user) => user.uid === uid)!);

    expect(of('broker1')).toEqual({ clients: 2, applications: 2 });
    expect(of('broker2')).toEqual({ clients: 1, applications: 1 });
    expect(of('borrower1')).toEqual({ clients: null, applications: 2 });
    expect(of('borrower3')).toEqual({ clients: null, applications: 0 });
    expect(of('underwriter1')).toEqual({ clients: null, applications: null });
  });
});

describe('chain figures', () => {
  const note = (minted: string, extra: Record<string, unknown> = {}) => ({
    tokenId: '1',
    contractAddress: `0x${'b'.repeat(40)}`,
    txHash: `0x${'a'.repeat(64)}`,
    auditHash: `0x${'c'.repeat(64)}`,
    network: 'amoy',
    mintedAt: Timestamp.fromDate(new Date(minted)),
    ...extra,
  });
  const ledger = () => [
    businessApplication('none'),
    businessApplication('open', { loanNote: note('2026-11-10T10:00:00Z'), auditTxHash: `0x${'d'.repeat(64)}` }),
    businessApplication('closed', {
      loanNote: note('2026-11-12T10:00:00Z', { closedAt: Timestamp.fromDate(new Date('2026-11-20T10:00:00Z')) }),
    }),
    // A close field that cannot be read: still a minted note, but neither open nor closed.
    businessApplication('unreadable', { loanNote: note('2026-11-11T10:00:00Z', { closedAt: 'yesterday' }) }),
  ];

  it('counts the notes minted, open and closed, and the audit hashes recorded in the registry', () => {
    const figures = chainFigures(ledger());
    expect({ ...figures, recent: undefined }).toEqual({ minted: 3, open: 1, closed: 1, recorded: 1, recent: undefined });
  });

  it('lists the most recent mints first, up to the limit', () => {
    expect(chainFigures(ledger()).recent.map(({ application }) => application.id)).toEqual(['closed', 'unreadable', 'open']);
    expect(chainFigures(ledger(), 2).recent).toHaveLength(2);
  });

  it('filters the audit trail by each ledger state', () => {
    const ids = (filter: Parameters<typeof matchesLedger>[1]) =>
      ledger().filter((application) => matchesLedger(application, filter)).map(({ id }) => id);
    expect(ids('minted')).toEqual(['open', 'closed', 'unreadable']);
    expect(ids('open')).toEqual(['open']);
    expect(ids('closed')).toEqual(['closed']);
    expect(ids('recorded')).toEqual(['open']);
  });
});
