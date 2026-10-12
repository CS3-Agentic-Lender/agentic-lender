import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationSummary } from './clientsService';
import {
  firestorePipelineService,
  readRiskTier,
  withRiskTiers,
  type PipelineErrorListener,
  type PipelineListener,
  type RiskTier,
} from './pipelineService';


interface TestDocument {
  id: string;
  ref: { path: string };
  data(): Record<string, unknown>;
}

interface TestSubscription {
  next(snapshot: { docs: TestDocument[] }): void;
  fail(error: { code: string }): void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const { subscriptions } = vi.hoisted(() => ({ subscriptions: [] as TestSubscription[] }));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  onSnapshot: vi.fn((
    _query: unknown,
    next: TestSubscription['next'],
    fail: TestSubscription['fail'],
  ) => {
    const unsubscribe = vi.fn();
    subscriptions.push({ next, fail, unsubscribe });
    return unsubscribe;
  }),
}));

beforeEach(() => {
  subscriptions.length = 0;
});

function document(path: string, data: Record<string, unknown>): TestDocument {
  return { id: path.split('/').at(-1)!, ref: { path }, data: () => data };
}

function subscribe() {
  const listener = vi.fn<PipelineListener>();
  const onError = vi.fn<PipelineErrorListener>();
  const stop = firestorePipelineService.subscribeToPipeline(listener, onError);
  expect(subscriptions).toHaveLength(2);
  const [applications, tiers] = subscriptions;
  return { listener, onError, stop, applications, tiers };
}

const storedApplication = document('applications/LN-1001', {
  borrowerId: 'borrower-1', status: 'Applied', ltvPct: 83,
});
const storedTier = document('applications/LN-1001/review/underwriting', { riskTier: 'B' });

function application(id: string, updatedAt: Date | null = null): ApplicationSummary {
  return {
    id,
    status: 'Applied',
    loanType: null,
    loanAmountEur: null,
    ltvPct: null,
    updatedAt,
  };
}

describe('reading a risk tier', () => {
  it.each(['A', 'B', 'C', 'D'] as const)('accepts tier %s', (tier) => {
    expect(readRiskTier(tier)).toBe(tier);
  });

  it.each([['Low'], ['Medium'], ['High'], ['a'], ['E'], [''], [1], [null], [undefined]])(
    'does not turn %j into a tier',
    (value) => {
      expect(readRiskTier(value)).toBeNull();
    },
  );
});

describe('attaching risk tiers to applications', () => {
  it('gives each application its own tier and leaves the rest without one', () => {
    const tiers = new Map<string, RiskTier>([
      ['LN-1001', 'B'],
      ['LN-9999', 'D'],
    ]);

    const result = withRiskTiers([application('LN-1001'), application('LN-1002')], tiers);

    expect(result.map(({ id, riskTier }) => [id, riskTier])).toEqual([
      ['LN-1001', 'B'],
      ['LN-1002', null],
    ]);
  });

  it('lists the most recently updated application first', () => {
    const result = withRiskTiers(
      [application('LN-1001', new Date('2026-10-01')), application('LN-1002', new Date('2026-10-05'))],
      new Map(),
    );

    expect(result.map(({ id }) => id)).toEqual(['LN-1002', 'LN-1001']);
  });
});

describe('live pipeline subscription', () => {
  it('publishes applications first and merges tiers when they answer later', () => {
    const { listener, applications, tiers, onError, stop } = subscribe();
    expect(listener).not.toHaveBeenCalled();

    applications.next({ docs: [storedApplication] });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      applications: [{ ...application('LN-1001'), ltvPct: 83, riskTier: null }],
      riskTierState: 'pending', riskTierError: null,
    });

    tiers.next({ docs: [storedTier] });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.lastCall?.[0]).toMatchObject({
      applications: [{ id: 'LN-1001', riskTier: 'B' }],
      riskTierState: 'available', riskTierError: null,
    });
    expect(onError).not.toHaveBeenCalled();
    stop();
  });

  it('remembers a tier refusal before applications answer without publishing early', () => {
    const { listener, applications, tiers, onError, stop } = subscribe();
    tiers.fail({ code: 'permission-denied' });
    expect(listener).not.toHaveBeenCalled();

    applications.next({ docs: [storedApplication] });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall?.[0]).toMatchObject({
      applications: [{ id: 'LN-1001', riskTier: null }],
      riskTierState: 'unavailable', riskTierError: 'permission-denied',
    });
    expect(onError).not.toHaveBeenCalled();
    stop();
  });

  it.each(['permission-denied', 'unavailable', 'internal'])('clears tiers after a later %s failure', (code) => {
    const { listener, applications, tiers, onError, stop } = subscribe();
    applications.next({ docs: [storedApplication] });
    tiers.next({ docs: [storedTier] });
    tiers.fail({ code });

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.lastCall?.[0]).toMatchObject({
      applications: [{ id: 'LN-1001', riskTier: null }],
      riskTierState: 'unavailable',
      riskTierError: code === 'permission-denied' ? 'permission-denied' : 'unavailable',
    });
    expect(onError).not.toHaveBeenCalled();
    stop();
  });

  it('merges tiers that answer before applications', () => {
    const { listener, applications, tiers, stop } = subscribe();
    tiers.next({ docs: [storedTier] });
    expect(listener).not.toHaveBeenCalled();
    applications.next({ docs: [storedApplication] });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall?.[0]).toMatchObject({
      applications: [{ id: 'LN-1001', riskTier: 'B' }],
      riskTierState: 'available', riskTierError: null,
    });
    stop();
  });

  it.each(['permission-denied', 'unavailable'])('stops both listeners on an applications %s error and ignores late callbacks', (code) => {
    const { listener, applications, tiers, onError, stop } = subscribe();
    applications.next({ docs: [storedApplication] });
    applications.fail({ code });

    expect(onError).toHaveBeenCalledExactlyOnceWith(code);
    expect(subscriptions.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
    const callsBeforeStop = listener.mock.calls.length;
    applications.next({ docs: [storedApplication] });
    tiers.next({ docs: [storedTier] });
    tiers.fail({ code: 'permission-denied' });
    applications.fail({ code });
    stop();

    expect(listener).toHaveBeenCalledTimes(callsBeforeStop);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(subscriptions.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('stop unsubscribes both listeners once and ignores all later publications', () => {
    const { listener, applications, tiers, onError, stop } = subscribe();
    stop();
    stop();
    applications.next({ docs: [storedApplication] });
    tiers.next({ docs: [storedTier] });
    tiers.fail({ code: 'permission-denied' });
    applications.fail({ code: 'unavailable' });

    expect(subscriptions.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps an application with no borrowerId in the queue', () => {
    const { listener, applications, stop } = subscribe();
    applications.next({ docs: [document('applications/LN-1002', { status: 'Draft', ltvPct: 72 })] });

    expect(listener.mock.lastCall?.[0].applications).toEqual([
      { id: 'LN-1002', status: 'Draft', loanType: null, loanAmountEur: null, ltvPct: 72, updatedAt: null, riskTier: null },
    ]);
    stop();
  });

  it('uses only applications/{id}/review/underwriting and ignores other parents and document ids', () => {
    const { listener, applications, tiers, stop } = subscribe();
    applications.next({ docs: [storedApplication, document('applications/LN-1002', { status: 'Draft' })] });
    tiers.next({ docs: [
      storedTier,
      document('users/LN-1001/review/underwriting', { riskTier: 'D' }),
      document('applications/LN-1001/review/other', { riskTier: 'C' }),
      document('users/borrower-1/applications/LN-1001/review/underwriting', { riskTier: 'A' }),
      document('applications/LN-1002/review/underwriting', { riskTier: 'Low' }),
      document('applications/LN-9999/review/underwriting', { riskTier: 'D' }),
    ] });

    expect(listener.mock.lastCall?.[0].applications.map(({ id, riskTier }) => [id, riskTier])).toEqual([
      ['LN-1001', 'B'], ['LN-1002', null],
    ]);
    stop();
  });
});
