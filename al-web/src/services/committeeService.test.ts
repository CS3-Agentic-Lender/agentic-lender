import { onSnapshot, Timestamp } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  firestoreCommitteeService, runDuration, toCommitteeCall, toCommitteeRun, type CommitteeViewer,
} from './committeeService';

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
      attempt: null, inputTokens: null, outputTokens: null, outcome: null, error: null, reusedFrom: null,
      marketReply: null,
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
    expect(run.trigger).toBeNull();
    expect(run.rerunOf).toBeNull();
  });

  it.each([
    [0, 42_250, '42.3 s'], [0, 83_400, '1 min 23 s'], [5_000, 1_000, null],
  ])('words a run from %i ms to %i ms as %s', (start, end, expected) => {
    expect(runDuration({ startedAt: new Date(start), finishedAt: new Date(end) })).toBe(expected);
    expect(runDuration({ startedAt: new Date(start), finishedAt: null })).toBeNull();
  });

  it('reads the run trigger and the run a re-run repeats', () => {
    expect(toCommitteeRun('run-2', { trigger: 'rerun', rerunOf: 'run-1' })).toMatchObject({ trigger: 'rerun', rerunOf: 'run-1' });
    expect(toCommitteeRun('run-1', { trigger: 'submit', rerunOf: null })).toMatchObject({ trigger: 'submit', rerunOf: null });
    expect(toCommitteeRun('run-3', { trigger: 'manual', rerunOf: 7 })).toMatchObject({ trigger: null, rerunOf: null });
  });

  it('reads a model call with its attempt, tokens, outcome and the market reply', () => {
    const call = toCommitteeCall('run-1-market-2', {
      agent: 'market', provider: 'gemini', model: 'gemini-3.1-flash-lite', attempt: 2,
      inputTokens: 1830, outputTokens: 212, outcome: 'ok', error: null, reusedFrom: null,
      createdAt: new Timestamp(10, 0), latencyMs: 2400,
      parsedReply: {
        outlook: 'rising', summary: 'Rates are rising.',
        sources: [{ url: 'https://www.ecb.europa.eu/press/pr/2026.html', date: '2026-10-29' }],
      },
    });
    expect(call).toEqual({
      id: 'run-1-market-2', agent: 'market', provider: 'gemini', model: 'gemini-3.1-flash-lite', output: null,
      latencyMs: 2400, createdAt: new Date(10_000), attempt: 2, inputTokens: 1830, outputTokens: 212,
      outcome: 'ok', error: null, reusedFrom: null,
      marketReply: {
        outlook: 'rising', summary: 'Rates are rising.',
        sources: [{ url: 'https://www.ecb.europa.eu/press/pr/2026.html', date: '2026-10-29' }],
      },
    });
  });

  it('reads a failed and a reused call without inventing numbers', () => {
    expect(toCommitteeCall('run-1-strategist-1', {
      agent: 'strategist', outcome: 'provider_error', error: 'HTTP 500', attempt: 1, inputTokens: null, outputTokens: undefined,
    })).toMatchObject({ outcome: 'provider_error', error: 'HTTP 500', attempt: 1, inputTokens: null, outputTokens: null, marketReply: null });
    expect(toCommitteeCall('run-1-market-reused', {
      agent: 'market', outcome: 'reused', attempt: null, reusedFrom: 'run-0-market-1', parsedReply: null,
    })).toMatchObject({ outcome: 'reused', attempt: null, reusedFrom: 'run-0-market-1', marketReply: null });
  });

  it.each([
    ['an unknown outcome', { outcome: 'success' }, { outcome: null }],
    ['a zero attempt', { attempt: 0 }, { attempt: null }],
    ['a fractional attempt', { attempt: 1.5 }, { attempt: null }],
    ['negative tokens', { inputTokens: -1, outputTokens: 'many' }, { inputTokens: null, outputTokens: null }],
  ])('keeps %s null', (_label, data, expected) => {
    expect(toCommitteeCall('call-1', { agent: 'affordability', ...data })).toMatchObject(expected);
  });

  it('reads no market reply from a search call, another agent, or a malformed reply', () => {
    // A search's parsedReply is its list of hits.
    expect(toCommitteeCall('run-1-market-search-1', { agent: 'market', parsedReply: [{ url: 'https://example.com', date: '2026-10-01' }] }).marketReply).toBeNull();
    expect(toCommitteeCall('run-1-affordability-1', { agent: 'affordability', parsedReply: { outlook: 'rising', sources: [] } }).marketReply).toBeNull();
    expect(toCommitteeCall('run-1-market-1', { agent: 'market', parsedReply: { outlook: 'soaring', summary: 7 } }).marketReply)
      .toEqual({ outlook: null, summary: null, sources: null });
  });

  it.each([
    ['a non-web address', [{ url: 'javascript:alert(1)', date: '2026-10-29' }]],
    ['an address that is not a URL', [{ url: 'ecb press release', date: '2026-10-29' }]],
    ['a missing date', [{ url: 'https://www.ecb.europa.eu/', date: '' }]],
    ['an item that is not a map', ['https://www.ecb.europa.eu/']],
    ['one bad item among good ones', [{ url: 'https://www.ecb.europa.eu/', date: '2026-10-29' }, { url: 'ftp://files.example/x', date: '2026-10-29' }]],
  ])('refuses market sources with %s', (_label, sources) => {
    const call = toCommitteeCall('run-1-market-1', { agent: 'market', parsedReply: { outlook: 'stable', summary: 'Stable.', sources } });
    expect(call.marketReply).toEqual({ outlook: 'stable', summary: 'Stable.', sources: null });
  });

  it('reads each step\'s live progress, with its times and a failed step\'s reason', () => {
    const at = (seconds: number) => Timestamp.fromMillis(seconds * 1000);
    const run = toCommitteeRun('run-1', {
      status: 'running',
      steps: {
        validate: { status: 'ok', startedAt: at(1), finishedAt: at(2) },
        valuation_model: { status: 'failed', startedAt: at(2), finishedAt: at(3), failureReason: 'The model is not loaded.' },
        market: { status: 'running', startedAt: at(3), finishedAt: null },
        calculations: { status: 'queued', startedAt: null, finishedAt: null },
      },
    });
    expect(run.steps?.validate).toEqual({ status: 'ok', startedAt: new Date(1000), finishedAt: new Date(2000), failureReason: null });
    expect(run.steps?.valuation_model).toMatchObject({ status: 'failed', failureReason: 'The model is not loaded.' });
    expect(run.steps?.market).toEqual({ status: 'running', startedAt: new Date(3000), finishedAt: null, failureReason: null });
    expect(run.steps?.calculations.status).toBe('queued');
  });

  it('reads a step that is missing or has an unknown status as queued, and no steps as null', () => {
    const run = toCommitteeRun('run-1', { status: 'running', steps: { validate: { status: 'done' }, market: 'running' } });
    expect(run.steps?.validate).toEqual({ status: 'queued', startedAt: null, finishedAt: null, failureReason: null });
    expect(run.steps?.market.status).toBe('queued');
    expect(run.steps?.policy_gate.status).toBe('queued');
    expect(toCommitteeRun('run-0', { status: 'complete' }).steps).toBeNull();
    expect(toCommitteeRun('run-0', { status: 'complete', steps: ['validate'] }).steps).toBeNull();
  });
});
