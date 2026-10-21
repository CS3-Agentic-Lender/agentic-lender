import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApplicationSummary, type ApplicationSummary } from './clientsService';
import { db } from './firebase';
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

interface TestSnapshot {
  docs: TestDocument[];
  // Defaults to a server answer; a cache answer sets fromCache.
  fromCache?: boolean;
  metadataOnly?: boolean;
}

interface TestSubscription {
  query: unknown;
  options: { includeMetadataChanges?: boolean };
  next(snapshot: TestSnapshot): void;
  fail(error: { code: string }): void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

interface TestQuery {
  kind: string;
  args: unknown[];
}

const { subscriptions, queryCalls } = vi.hoisted(() => ({
  subscriptions: [] as TestSubscription[],
  queryCalls: [] as TestQuery[],
}));

// The query builders record their arguments so a test can assert the queries themselves.
vi.mock('firebase/firestore', async (importOriginal) => {
  const record = (kind: string) =>
    vi.fn((...args: unknown[]): TestQuery => {
      const call = { kind, args };
      queryCalls.push(call);
      return call;
    });

  return {
    ...(await importOriginal<typeof import('firebase/firestore')>()),
    collection: record('collection'),
    collectionGroup: record('collectionGroup'),
    query: record('query'),
    where: record('where'),
    onSnapshot: vi.fn((
      query: unknown,
      optionsOrNext: TestSubscription['options'] | ((snapshot: unknown) => void),
      nextOrFail: (snapshot: never) => void,
      errorHandler?: TestSubscription['fail'],
    ) => {
      // Support both SDK overloads so removing the options reproduces event suppression.
      const options = typeof optionsOrNext === 'function' ? {} : optionsOrNext;
      const next = (typeof optionsOrNext === 'function' ? optionsOrNext : nextOrFail) as (snapshot: unknown) => void;
      const fail = (typeof optionsOrNext === 'function' ? nextOrFail : errorHandler) as TestSubscription['fail'];
      const unsubscribe = vi.fn();
      subscriptions.push({
        query,
        options,
        next: ({ docs, fromCache = false, metadataOnly = false }) => {
          if (metadataOnly && !options.includeMetadataChanges) {
            return;
          }
          next({ docs, empty: docs.length === 0, metadata: { fromCache } });
        },
        fail,
        unsubscribe,
      });
      return unsubscribe;
    }),
  };
});

beforeEach(() => {
  subscriptions.length = 0;
  queryCalls.length = 0;
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
    borrowerName: null,
    loanAmountEur: null,
    ltvPct: null,
    ltvBand: null,
    riskTier: null,
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
  it.each(['', 'unknown', 1, {}])('never replaces an invalid stored tier %j with a review tier', (riskTier) => {
    const stored = toApplicationSummary('stored', { ltvBand: 'over_90', riskTier, ltvPct: 75 });
    expect(withRiskTiers([stored], new Map([['stored', 'A']]))[0]).toMatchObject({
      ltvBand: 'over_90', riskTier: 'invalid', storedRiskTier: 'invalid',
    });
  });

  it.each([undefined, null])('falls back for absent tier %j even with an invalid band', (riskTier) => {
    const stored = toApplicationSummary('stored', { ltvBand: '', riskTier, ltvPct: 75 });
    expect(withRiskTiers([stored], new Map([['stored', 'B']]))[0]).toMatchObject({
      ltvBand: 'invalid', riskTier: 'B', storedRiskTier: null,
    });
  });

  it('keeps a valid stored tier independent of an invalid band', () => {
    const stored = toApplicationSummary('stored', { ltvBand: {}, riskTier: 'D', ltvPct: 75 });
    expect(withRiskTiers([stored], new Map([['stored', 'A']]))[0]).toMatchObject({
      ltvBand: 'invalid', riskTier: 'D', storedRiskTier: 'D',
    });
  });

  it('keeps the stored tier ahead of a different review tier', () => {
    const stored = toApplicationSummary('stored', { ltvBand: 'over_90', riskTier: 'D', ltvPct: 85 });
    expect(withRiskTiers([stored], new Map([['stored', 'A']]))[0]).toMatchObject({
      ltvBand: 'over_90', ltvPct: 85, riskTier: 'D', storedRiskTier: 'D',
    });
  });

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

describe('pipeline queries', () => {
  it('reads the whole applications collection with no filter', () => {
    const { applications, stop } = subscribe();

    expect(applications.query).toEqual({ kind: 'collection', args: [db, 'applications'] });
    expect(applications.options).toEqual({ includeMetadataChanges: true });
    expect(queryCalls.filter(({ kind }) => kind === 'where' || kind === 'query')).toEqual([]);
    stop();
  });

  it('reads the review collection group for tiers, not reviews', () => {
    const { tiers, stop } = subscribe();

    expect(tiers.query).toEqual({ kind: 'collectionGroup', args: [db, 'review'] });
    expect(tiers.options).toEqual({ includeMetadataChanges: true });
    stop();
  });
});

describe('an empty snapshot from the cache', () => {
  it('is not published as an empty queue until the server answers', () => {
    const { listener, applications, onError, stop } = subscribe();

    applications.next({ docs: [], fromCache: true });
    expect(listener).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    applications.next({ docs: [], fromCache: false, metadataOnly: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall?.[0].applications).toEqual([]);
    stop();
  });

  it('still lets the error path fire for the applications listener', () => {
    const { listener, applications, onError, stop } = subscribe();

    applications.next({ docs: [], fromCache: true });
    applications.fail({ code: 'unavailable' });

    expect(listener).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    stop();
  });

  it('publishes a cache snapshot that holds documents', () => {
    const { listener, applications, stop } = subscribe();

    applications.next({ docs: [storedApplication], fromCache: true });

    expect(listener.mock.lastCall?.[0].applications).toMatchObject([{ id: 'LN-1001' }]);
    stop();
  });

  it('keeps tiers pending instead of marking them available', () => {
    const { listener, applications, tiers, stop } = subscribe();
    applications.next({ docs: [storedApplication] });
    tiers.next({ docs: [], fromCache: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall?.[0]).toMatchObject({ riskTierState: 'pending', riskTierError: null });

    tiers.next({ docs: [storedTier], fromCache: false });
    expect(listener.mock.lastCall?.[0]).toMatchObject({
      applications: [{ id: 'LN-1001', riskTier: 'B' }],
      riskTierState: 'available',
    });
    stop();
  });

  it('marks tiers available once the server confirms there are none', () => {
    const { listener, applications, tiers, stop } = subscribe();
    applications.next({ docs: [storedApplication] });
    tiers.next({ docs: [], fromCache: true });
    tiers.next({ docs: [], fromCache: false, metadataOnly: true });

    expect(listener.mock.lastCall?.[0]).toMatchObject({
      applications: [{ id: 'LN-1001', riskTier: null }],
      riskTierState: 'available',
    });
    stop();
  });

  it('lets a tier failure follow a cache-empty tier snapshot', () => {
    const { listener, applications, tiers, stop } = subscribe();
    applications.next({ docs: [storedApplication] });
    tiers.next({ docs: [], fromCache: true });
    tiers.fail({ code: 'permission-denied' });

    expect(listener.mock.lastCall?.[0]).toMatchObject({
      riskTierState: 'unavailable',
      riskTierError: 'permission-denied',
    });
    stop();
  });
});

describe('live pipeline subscription', () => {
  it('uses stored fields independently and falls back only for absent fields', () => {
    const { listener, applications, tiers, stop } = subscribe();
    applications.next({ docs: [
      document('applications/both', { ltvBand: 'over_90', riskTier: 'D', ltvPct: 85 }),
      document('applications/band-only', { ltvBand: '80_or_less', ltvPct: 95 }),
      document('applications/tier-only', { riskTier: 'C', ltvPct: 85 }),
      document('applications/invalid', { ltvBand: '>90%', riskTier: 'a', ltvPct: 75 }),
      document('applications/neither', {}),
    ] });
    tiers.next({ docs: ['both', 'band-only', 'tier-only', 'invalid'].map((id) =>
      document(`applications/${id}/review/underwriting`, { riskTier: 'B' }),
    ) });

    expect(listener.mock.lastCall?.[0].applications).toEqual([
      expect.objectContaining({ id: 'band-only', ltvBand: '80_or_less', riskTier: 'B', storedRiskTier: null }),
      expect.objectContaining({ id: 'both', ltvBand: 'over_90', riskTier: 'D', storedRiskTier: 'D' }),
      expect.objectContaining({ id: 'invalid', ltvBand: 'invalid', riskTier: 'invalid', storedRiskTier: 'invalid' }),
      expect.objectContaining({ id: 'neither', ltvBand: null, riskTier: null, storedRiskTier: null }),
      expect.objectContaining({ id: 'tier-only', ltvBand: null, riskTier: 'C', storedRiskTier: 'C' }),
    ]);
    stop();
  });

  it('keeps stored tiers when the fallback fails and updates them live', () => {
    const { listener, applications, tiers, stop } = subscribe();
    applications.next({ docs: [storedApplication] });
    tiers.next({ docs: [storedTier] });
    applications.next({ docs: [document('applications/LN-1001', {
      ltvPct: 83, ltvBand: 'over_90', riskTier: 'D',
    })] });
    expect(listener.mock.lastCall?.[0].applications[0]).toMatchObject({
      ltvBand: 'over_90', riskTier: 'D', storedRiskTier: 'D',
    });
    tiers.fail({ code: 'permission-denied' });
    expect(listener.mock.lastCall?.[0]).toMatchObject({
      applications: [{ ltvBand: 'over_90', riskTier: 'D', storedRiskTier: 'D' }],
      riskTierState: 'unavailable',
    });
    stop();
  });

  it('publishes applications first and merges tiers when they answer later', () => {
    const { listener, applications, tiers, onError, stop } = subscribe();
    expect(listener).not.toHaveBeenCalled();

    applications.next({ docs: [storedApplication] });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      applications: [{ ...application('LN-1001'), ltvPct: 83, riskTier: null, storedRiskTier: null }],
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
      { ...application('LN-1002'), status: 'Draft', ltvPct: 72, storedRiskTier: null },
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
