import { describe, expect, it } from 'vitest';
import { buildBrokerClients, type ApplicationSummary, type BrokerApplication, type StatusMove } from '../../services/clientsService';
import type { CommitteeRun } from '../../services/committeeService';
import {
  awaitingDecision,
  brokerFigures,
  enteredStatusAt,
  needsAttention,
  recentActivity,
  startOfWeek,
  underwriterFigures,
} from './overviewFigures';

// Local times, so "this week" does not depend on the machine's time zone.
const local = (day: number, hour = 12) => new Date(2026, 10, day, hour);
// Wednesday 25 November 2026; the week began on Monday 23 November.
const NOW = local(25);

function move(to: string, at: Date, from: string | null = null, actor = 'underwriter', actorId = 'uw-1'): StatusMove {
  return { from, to, actor, actorId, at };
}

function app(id: string, status: string, extra: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return { id, status, loanType: 'mortgage', loanAmountEur: 200000, ltvPct: null, updatedAt: null, ...extra };
}

describe('startOfWeek', () => {
  it('is Monday midnight, also on a Sunday', () => {
    expect(startOfWeek(NOW)).toEqual(new Date(2026, 10, 23));
    expect(startOfWeek(local(29))).toEqual(new Date(2026, 10, 23));
    expect(startOfWeek(new Date(2026, 10, 23, 0, 0))).toEqual(new Date(2026, 10, 23));
  });
});

describe('underwriter figures', () => {
  const applications = [
    app('LN-1', 'AI Deliberated', { ltvPct: 80, aiRunStatus: 'complete' }),
    app('LN-2', 'AI Deliberated', { ltvPct: 90 }),
    app('LN-3', 'Applied', { aiRunStatus: 'running', ltvPct: 70 }),
    app('LN-4', 'Applied', { aiRunStatus: 'failed' }),
    // Approved this week, since funded: still an approval made this week.
    app('LN-5', 'Funded', { ltvPct: 60, statusHistory: [move('Underwriter Approved', local(24)), move('Funded', local(24, 14))] }),
    // Approved last Sunday: not this week.
    app('LN-6', 'Underwriter Approved', { statusHistory: [move('Underwriter Approved', local(22))] }),
    app('LN-7', 'Underwriter Approved', { statusHistory: [move('Underwriter Approved', local(23, 9))] }),
    // A Draft's LTV is not counted; a negative LTV is unusable.
    app('LN-8', 'Draft', { ltvPct: 99 }),
    app('LN-9', 'Declined', { ltvPct: -5 }),
  ];

  it('counts each tile from the stored fields', () => {
    expect(underwriterFigures(applications, NOW)).toEqual({
      awaitingDecision: 2,
      aiRunning: 1,
      aiFailed: 1,
      approvedThisWeek: 2,
      averageLtvPct: 75,
      ltvCount: 4,
    });
  });

  it('has no average LTV when no submitted application stores one', () => {
    expect(underwriterFigures([app('LN-1', 'Applied'), app('LN-2', 'Draft', { ltvPct: 50 })], NOW)).toMatchObject({
      averageLtvPct: null,
      ltvCount: 0,
    });
  });
});

describe('needs your decision', () => {
  it('lists AI Deliberated applications oldest first, by the move into that status, else the last update', () => {
    const rows = awaitingDecision([
      app('LN-new', 'AI Deliberated', { statusHistory: [move('AI Deliberated', local(24), 'Applied', 'committee')] }),
      app('LN-applied', 'Applied', { updatedAt: local(1) }),
      app('LN-old', 'AI Deliberated', { updatedAt: local(25), statusHistory: [move('AI Deliberated', local(20), 'Applied', 'committee')] }),
      app('LN-untimed', 'AI Deliberated'),
      app('LN-mid', 'AI Deliberated', { updatedAt: local(22) }),
    ]);

    expect(rows.map((row) => row.application.id)).toEqual(['LN-old', 'LN-mid', 'LN-new', 'LN-untimed']);
    expect(rows[0].since).toEqual(local(20));
  });

  it('takes the latest move into the status after a re-run', () => {
    expect(
      enteredStatusAt(
        app('LN-1', 'AI Deliberated', { statusHistory: [move('AI Deliberated', local(2)), move('AI Deliberated', local(9))] }),
        'AI Deliberated',
      ),
    ).toEqual(local(9));
  });
});

describe('recent activity', () => {
  it('merges every application history newest first, up to the limit', () => {
    const entries = recentActivity(
      [
        app('LN-1', 'AI Deliberated', {
          borrowerName: 'Alice Byrne',
          statusHistory: [move('Applied', local(20), 'Draft', 'borrower'), move('AI Deliberated', local(22), 'Applied', 'committee')],
        }),
        app('LN-2', 'Applied', { statusHistory: [move('Applied', local(21), 'Draft', 'borrower')] }),
      ],
      undefined,
      2,
    );

    expect(entries.map((entry) => [entry.applicationId, entry.move.to, entry.name])).toEqual([
      ['LN-1', 'AI Deliberated', 'Alice Byrne'],
      ['LN-2', 'Applied', null],
    ]);
  });
});

describe('broker figures and attention list', () => {
  const brokerApp = (id: string, borrowerId: string, status: string, extra: Partial<BrokerApplication> = {}): BrokerApplication => ({
    ...app(id, status, extra),
    borrowerId,
  });
  const run = (id: string, applicationId: string, conditions: string[]): CommitteeRun =>
    ({ id, applicationId, policyGate: { original: null, effective: null, conditions, breaches: [], changed: null } }) as unknown as CommitteeRun;

  const applications = [
    brokerApp('LN-1', 'alice', 'Applied'),
    brokerApp('LN-2', 'alice', 'AI Deliberated', { aiRunId: 'run-2', updatedAt: local(20) }),
    brokerApp('LN-3', 'ben', 'Underwriter Approved', { aiRunId: 'run-3', updatedAt: local(21) }),
    brokerApp('LN-4', 'ben', 'Funded'),
    brokerApp('LN-5', 'cara', 'Declined', { updatedAt: local(24) }),
    brokerApp('LN-6', 'cara', 'Closed', { aiRunId: 'run-6' }),
  ];
  const clients = buildBrokerClients(
    [
      { uid: 'alice', fullName: 'Alice Byrne', email: null, county: null },
      { uid: 'ben', fullName: 'Ben Walsh', email: null, county: null },
      { uid: 'cara', fullName: 'Cara Doyle', email: null, county: null },
    ],
    applications,
  );

  it('counts active, awaiting AI and approved applications', () => {
    expect(brokerFigures(applications)).toEqual({ active: 3, awaitingAi: 1, approved: 2, awaitingFunding: 1 });
  });

  it('lists declined files, conditions to meet and unread threads, most recently updated first', () => {
    const runs = new Map([
      ['run-2', run('run-2', 'LN-2', ['Provide payslips'])],
      // No conditions: nothing to meet.
      ['run-3', run('run-3', 'LN-3', [])],
      // Closed: conditions no longer apply.
      ['run-6', run('run-6', 'LN-6', ['Obtain a survey'])],
    ]);
    const items = needsAttention(clients, runs, new Map([['LN-1', 2], ['LN-4', 0]]));

    expect(items.map((item) => [item.application.id, item.clientName, item.declined, item.conditions, item.unread])).toEqual([
      ['LN-5', 'Cara Doyle', true, [], 0],
      ['LN-2', 'Alice Byrne', false, ['Provide payslips'], 0],
      ['LN-1', 'Alice Byrne', false, [], 2],
    ]);
  });

  it('claims no conditions while the runs are unavailable, or from a run of another application', () => {
    expect(needsAttention(clients, null, new Map()).map((item) => item.application.id)).toEqual(['LN-5']);
    const misfiled = new Map([['run-2', run('run-2', 'LN-other', ['Provide payslips'])]]);
    expect(needsAttention(clients, misfiled, new Map()).map((item) => item.application.id)).toEqual(['LN-5']);
  });
});
