import { onSnapshot, Timestamp } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firestoreCommitteeService, toCommitteeRun, type CommitteeViewer } from './committeeService';

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  onSnapshot: vi.fn(),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  where: vi.fn((field: string, operator: string, value: string) => ({ field, operator, value })),
  query: vi.fn((collection: unknown, ...constraints: unknown[]) => ({ collection, constraints })),
}));

function documentOf(id: string, data: Record<string, unknown> | undefined, fromCache = false) {
  return { id, data: () => data, metadata: { fromCache } };
}

function queryOf(entries: [string, Record<string, unknown>][], fromCache = false) {
  return { docs: entries.map(([id, data]) => documentOf(id, data)), metadata: { fromCache } };
}

interface Subscription {
  ref: unknown;
  next: (snapshot: ReturnType<typeof documentOf> | ReturnType<typeof queryOf>) => void;
  error: (error: { code: string }) => void;
  stop: ReturnType<typeof vi.fn>;
}
let subscriptions: Subscription[] = [];
const underwriter: CommitteeViewer = { uid: 'underwriter-1', role: 'underwriter' };
const broker: CommitteeViewer = { uid: 'broker-1', role: 'broker' };

function subscribe(viewer = underwriter) {
  const listener = vi.fn();
  const stop = firestoreCommitteeService.subscribeToRun('LN-1001', viewer, listener);
  return { listener, stop, application: subscriptions[0] };
}

function runData(seconds: number) {
  return { applicationId: 'LN-1001', brokerId: 'broker-1', status: 'complete', startedAt: new Timestamp(seconds, 0) };
}

beforeEach(() => {
  subscriptions = [];
  vi.mocked(onSnapshot).mockReset();
  vi.mocked(onSnapshot).mockImplementation((...args: unknown[]) => {
    const callbacks = args.filter((arg) => typeof arg === 'function');
    const stop = vi.fn();
    subscriptions.push({ ref: args[0], next: callbacks[0] as Subscription['next'], error: callbacks[1] as Subscription['error'], stop });
    return stop;
  });
});

describe('committee subscriptions', () => {
  it.each([broker, underwriter])('builds authorised unordered queries for $role runs and calls', (viewer) => {
    const { application } = subscribe(viewer);
    application.next(documentOf('LN-1001', { brokerId: 'broker-1' }));
    const ownerFilter = viewer.role === 'broker' ? [{ field: 'brokerId', operator: '==', value: 'broker-1' }] : [];
    expect(subscriptions[1].ref).toEqual({ collection: { path: 'ai_runs' }, constraints: [
      { field: 'applicationId', operator: '==', value: 'LN-1001' }, ...ownerFilter,
    ] });
    firestoreCommitteeService.subscribeToCalls('run-LN-1001', viewer, vi.fn());
    expect(subscriptions[2].ref).toEqual({ collection: { path: 'ai_calls' }, constraints: [
      { field: 'runId', operator: '==', value: 'run-LN-1001' }, ...ownerFilter,
    ] });
  });

  it('selects the newest startedAt in code and follows new results live', () => {
    const { application, listener } = subscribe();
    application.next(documentOf('LN-1001', {}));
    const runs = subscriptions[1];
    runs.next(queryOf([['run-new', runData(30)], ['run-old', runData(10)], ['run-middle', runData(20)]]));
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', run: expect.objectContaining({ id: 'run-new' }) }));
    runs.next(queryOf([['run-newest', { ...runData(40), status: 'running' }], ['run-new', runData(30)]]));
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ run: expect.objectContaining({ id: 'run-newest', status: 'running' }) }));
  });

  it('uses aiRunId directly, switches listeners, and ignores superseded callbacks', () => {
    const { application, listener, stop } = subscribe();
    application.next(documentOf('LN-1001', { aiRunId: 'run-first' }));
    const first = subscriptions[1];
    expect(first.ref).toEqual({ path: 'ai_runs/run-first' });
    first.next(documentOf('run-first', runData(10)));
    application.next(documentOf('LN-1001', { aiRunId: 'run-second' }));
    expect(first.stop).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith({ status: 'loading' });
    first.next(documentOf('run-first', runData(10)));
    first.error({ code: 'permission-denied' });
    expect(listener).toHaveBeenLastCalledWith({ status: 'loading' });
    subscriptions[2].next(documentOf('run-second', runData(20)));
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ run: expect.objectContaining({ id: 'run-second' }) }));
    stop();
    stop();
    expect(application.stop).toHaveBeenCalledOnce();
    expect(subscriptions[2].stop).toHaveBeenCalledOnce();
    listener.mockClear();
    subscriptions[2].next(documentOf('run-second', runData(20)));
    application.next(documentOf('LN-1001', {}));
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not mistake cache results for authorised or missing records', () => {
    const { application, listener } = subscribe();
    application.next(documentOf('LN-1001', {}, true));
    expect(subscriptions).toHaveLength(1);
    application.next(documentOf('LN-1001', {}));
    subscriptions[1].next(queryOf([], true));
    expect(listener).toHaveBeenLastCalledWith({ status: 'loading' });
    subscriptions[1].next(queryOf([]));
    expect(listener).toHaveBeenLastCalledWith({ status: 'missing' });
  });

  it('shows a missing referenced run without silently substituting an older one', () => {
    const { application, listener } = subscribe();
    application.next(documentOf('LN-1001', { aiRunId: 'run-missing' }));
    subscriptions[1].next(documentOf('run-missing', undefined));
    expect(listener).toHaveBeenLastCalledWith({ status: 'missing' });
    expect(subscriptions).toHaveLength(2);
  });

  it.each(['permission-denied', 'unavailable'])('reports %s and clears the run on a listener failure', (code) => {
    const { application, listener } = subscribe();
    application.next(documentOf('LN-1001', {}));
    subscriptions[1].next(queryOf([['run-LN-1001', runData(10)]]));
    subscriptions[1].error({ code });
    expect(listener).toHaveBeenLastCalledWith({ status: code === 'permission-denied' ? code : 'error' });
    expect(application.stop).toHaveBeenCalledOnce();
    expect(subscriptions[1].stop).toHaveBeenCalledOnce();
  });

  it('refuses a mismatched broker application and a run from another application', () => {
    const { application, listener } = subscribe(broker);
    application.next(documentOf('LN-1001', { brokerId: 'another-broker' }));
    expect(listener).toHaveBeenLastCalledWith({ status: 'permission-denied' });
    expect(subscriptions).toHaveLength(1);
    const otherListener = vi.fn();
    firestoreCommitteeService.subscribeToRun('LN-1001', underwriter, otherListener);
    subscriptions[1].next(documentOf('LN-1001', { aiRunId: 'run-wrong' }));
    subscriptions[2].next(documentOf('run-wrong', { ...runData(10), applicationId: 'LN-1002' }));
    expect(otherListener).toHaveBeenLastCalledWith({ status: 'error' });
  });

  it('streams stored calls, represents missing metadata honestly, and stops on unmount', () => {
    const listener = vi.fn();
    const stop = firestoreCommitteeService.subscribeToCalls('run-LN-1001', underwriter, listener);
    const calls = subscriptions[0];
    calls.next(queryOf([], true));
    expect(listener).toHaveBeenLastCalledWith({ status: 'loading' });
    calls.next(queryOf([['call-LN-1001', { agent: 'market', output: 'Outlook', latencyMs: 0 }]]));
    expect(listener).toHaveBeenLastCalledWith({ status: 'ready', calls: [{
      id: 'call-LN-1001', agent: 'market', output: 'Outlook', latencyMs: 0,
      provider: null, model: null, createdAt: null,
    }] });
    stop();
    listener.mockClear();
    calls.next(queryOf([]));
    calls.error({ code: 'permission-denied' });
    expect(listener).not.toHaveBeenCalled();
    expect(calls.stop).toHaveBeenCalledOnce();
  });

  it.each(['permission-denied', 'unavailable'])('reports a calls-only %s error', (code) => {
    const listener = vi.fn();
    firestoreCommitteeService.subscribeToCalls('run-LN-1001', broker, listener);
    subscriptions[0].error({ code });
    expect(listener).toHaveBeenLastCalledWith({ status: code === 'permission-denied' ? code : 'error' });
  });

  it('keeps absent or invalid stored outputs null instead of inventing recommendations', () => {
    const run = toCommitteeRun('run-LN-1001', {
      status: 'approved', recommendation: 'approve', consensus: { disagreement: 'false' },
      agents: { valuation: { rating: 90, concerns: ['Concern', 12], conditions: [] } },
    });
    expect(run.status).toBeNull();
    expect(run.originalRecommendation).toBeNull();
    expect(run.effectiveRecommendation).toBeNull();
    expect(run.consensus.disagreement).toBeNull();
    expect(run.agents.valuation).toMatchObject({ rating: null, concerns: null, conditions: [] });
    expect(run.agents.market).toBeNull();
  });
});
