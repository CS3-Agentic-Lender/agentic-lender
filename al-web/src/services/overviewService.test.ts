import { onSnapshot, Timestamp } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStatusHistory, toApplicationSummary } from './clientsService';
import { firestoreOverviewService } from './overviewService';

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  onSnapshot: vi.fn(),
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
  query: vi.fn((source: unknown, ...constraints: unknown[]) => ({ kind: 'query', source, constraints })),
}));

beforeEach(() => {
  vi.mocked(onSnapshot).mockReset();
  vi.mocked(onSnapshot).mockReturnValue(vi.fn());
});

describe('broker committee runs for the overview', () => {
  it('queries ai_runs filtered on the broker uid, as the rules require', () => {
    const listener = vi.fn();
    firestoreOverviewService.subscribeToBrokerRuns('broker-1', listener, vi.fn());

    expect(vi.mocked(onSnapshot).mock.calls[0][0]).toEqual({
      kind: 'query',
      source: { kind: 'collection', path: 'ai_runs' },
      constraints: [{ kind: 'where', field: 'brokerId', op: '==', value: 'broker-1' }],
    });
  });

  it('parses each run and does not publish an empty cache answer', () => {
    const listener = vi.fn();
    firestoreOverviewService.subscribeToBrokerRuns('broker-1', listener, vi.fn());
    const next = (vi.mocked(onSnapshot).mock.calls[0] as unknown[]).find((argument) => typeof argument === 'function') as (
      snapshot: unknown,
    ) => void;

    next({ docs: [], empty: true, metadata: { fromCache: true } });
    expect(listener).not.toHaveBeenCalled();

    next({
      docs: [{ id: 'run-1', data: () => ({ applicationId: 'LN-1', brokerId: 'broker-1', policyGate: { conditions: ['Provide payslips'] } }) }],
      empty: false,
      metadata: { fromCache: false },
    });
    expect(listener.mock.calls[0][0][0]).toMatchObject({ id: 'run-1', applicationId: 'LN-1', policyGate: { conditions: ['Provide payslips'] } });
  });
});

describe('stored status history and AI run fields', () => {
  const at = Timestamp.fromDate(new Date('2026-11-20T09:00:00Z'));

  it('reads each move and drops entries without a target status or time', () => {
    expect(
      readStatusHistory([
        { from: 'Draft', to: 'Applied', actor: 'borrower', actorId: 'alice', at },
        { from: 'Applied', to: 'AI Deliberated', actor: 'committee', actorId: 'al-ai' },
        { to: 12, at },
        'not a move',
        { to: 'Declined', at },
      ]),
    ).toEqual([
      { from: 'Draft', to: 'Applied', actor: 'borrower', actorId: 'alice', at: at.toDate() },
      { from: null, to: 'Declined', actor: null, actorId: null, at: at.toDate() },
    ]);
    expect(readStatusHistory(undefined)).toEqual([]);
  });

  it('adds aiRunStatus, aiRunId and statusHistory to the summary only when they are stored', () => {
    const summary = toApplicationSummary('LN-1', {
      status: 'Applied',
      aiRunStatus: 'running',
      aiRunId: 'run-1',
      statusHistory: [{ from: 'Draft', to: 'Applied', actor: 'borrower', actorId: 'alice', at }],
    });
    expect(summary).toMatchObject({ aiRunStatus: 'running', aiRunId: 'run-1', statusHistory: [{ to: 'Applied' }] });

    const bare = toApplicationSummary('LN-2', { status: 'Applied', aiRunStatus: 'queued' });
    expect('aiRunStatus' in bare).toBe(false);
    expect('aiRunId' in bare).toBe(false);
    expect('statusHistory' in bare).toBe(false);
  });
});
