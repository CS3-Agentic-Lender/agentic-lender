import { onSnapshot } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firestoreClientsService } from './clientsService';

// The query builders are replaced by recorders so that a test can read the query a listener
// subscribed with: which collection, and which constraints.
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  onSnapshot: vi.fn(),
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
  query: vi.fn((source: unknown, ...constraints: unknown[]) => ({ kind: 'query', source, constraints })),
}));

interface FakeSnapshot {
  docs: Array<{ id: string; data: () => Record<string, string> }>;
  empty: boolean;
  metadata: { fromCache: boolean };
}

function snapshotOf(docs: FakeSnapshot['docs'], fromCache = false): FakeSnapshot {
  return { docs, empty: docs.length === 0, metadata: { fromCache } };
}

const applications = snapshotOf([
  { id: 'LN-1001', data: () => ({ borrowerId: 'borrower-1', status: 'Applied' }) },
]);
const profiles = snapshotOf([{ id: 'borrower-1', data: () => ({ fullName: 'Alice Byrne' }) }]);
const serverEmpty = snapshotOf([]);
const cacheEmpty = snapshotOf([], true);

function subscribe() {
  const listener = vi.fn();
  const onError = vi.fn();
  const unsubscribeApplications = vi.fn();
  const unsubscribeProfiles = vi.fn();
  vi.mocked(onSnapshot)
    .mockReturnValueOnce(unsubscribeApplications)
    .mockReturnValueOnce(unsubscribeProfiles);
  const stop = firestoreClientsService.subscribeToBrokerClients('broker-1', listener, onError);
  // Each call is (query, options, onNext, onError): pick the parts by what they are.
  const calls = vi.mocked(onSnapshot).mock.calls as unknown as unknown[][];
  const [applicationsCall, profilesCall] = calls.map((call) => {
    const callbacks = call.filter((argument) => typeof argument === 'function');

    return {
      query: call[0],
      options: call.find((argument, index) => index > 0 && typeof argument === 'object'),
      next: callbacks[0] as (snapshot: FakeSnapshot) => void,
      error: callbacks[1] as (error: { code: string }) => void,
    };
  });

  return {
    listener,
    onError,
    stop,
    unsubscribeApplications,
    unsubscribeProfiles,
    applicationsQuery: applicationsCall.query,
    applicationsOptions: applicationsCall.options,
    applicationsNext: applicationsCall.next,
    applicationsError: applicationsCall.error,
    profilesQuery: profilesCall.query,
    profilesOptions: profilesCall.options,
    profilesNext: profilesCall.next,
    profilesError: profilesCall.error,
  };
}

beforeEach(() => vi.mocked(onSnapshot).mockReset());

describe('broker clients queries', () => {
  it('reads applications where brokerId is the signed-in broker and the status is not Draft', () => {
    const subscription = subscribe();
    expect(subscription.applicationsQuery).toEqual({
      kind: 'query',
      source: { kind: 'collection', path: 'applications' },
      constraints: [
        { kind: 'where', field: 'brokerId', op: '==', value: 'broker-1' },
        { kind: 'where', field: 'status', op: '!=', value: 'Draft' },
      ],
    });
  });

  it('reads users where brokerId is the signed-in broker', () => {
    const subscription = subscribe();
    expect(subscription.profilesQuery).toEqual({
      kind: 'query',
      source: { kind: 'collection', path: 'users' },
      constraints: [{ kind: 'where', field: 'brokerId', op: '==', value: 'broker-1' }],
    });
  });

  it('builds both queries from the broker it was given', () => {
    vi.mocked(onSnapshot).mockReturnValue(vi.fn());
    firestoreClientsService.subscribeToBrokerClients('broker-2', vi.fn(), vi.fn());
    const queries = vi.mocked(onSnapshot).mock.calls.map(([source]) => source) as unknown as Array<{
      constraints: Array<{ field: string; value: string }>;
    }>;
    const brokerIds = queries.map(({ constraints }) =>
      constraints.filter(({ field }) => field === 'brokerId').map(({ value }) => value),
    );
    expect(brokerIds).toEqual([['broker-2'], ['broker-2']]);
  });
});

describe('broker clients without Drafts', () => {
  // The Draft is filtered out by the query, so the server answers without it.
  const draftOnlyProfile = snapshotOf([{ id: 'borrower-2', data: () => ({ fullName: 'Ben Walsh' }) }]);

  it('keeps a borrower whose only application is a Draft as a client with no applications', () => {
    const subscription = subscribe();
    subscription.applicationsNext(serverEmpty);
    subscription.profilesNext(draftOnlyProfile);
    expect(subscription.listener).toHaveBeenLastCalledWith({
      clients: [{
        id: 'borrower-2',
        profile: expect.objectContaining({ fullName: 'Ben Walsh' }),
        applications: [],
      }],
      profilesState: 'available',
    });
  });
});

describe('broker clients subscription', () => {
  it('publishes applications first while profiles are pending, then adds names', () => {
    const subscription = subscribe();
    expect(subscription.listener).not.toHaveBeenCalled();
    subscription.applicationsNext(applications);
    expect(subscription.listener).toHaveBeenLastCalledWith({
      clients: [expect.objectContaining({
        id: 'borrower-1',
        profile: null,
        applications: [expect.objectContaining({ id: 'LN-1001' })],
      })],
      profilesState: 'pending',
    });
    subscription.profilesNext(profiles);
    expect(subscription.listener).toHaveBeenCalledTimes(2);
    expect(subscription.listener).toHaveBeenLastCalledWith({
      clients: [expect.objectContaining({ profile: expect.objectContaining({ fullName: 'Alice Byrne' }) })],
      profilesState: 'available',
    });
  });

  it('waits for applications when profiles arrive first', () => {
    const subscription = subscribe();
    subscription.profilesNext(profiles);
    expect(subscription.listener).not.toHaveBeenCalled();
    subscription.applicationsNext(applications);
    expect(subscription.listener).toHaveBeenLastCalledWith(expect.objectContaining({ profilesState: 'available' }));
  });

  it('publishes an empty application result while profiles are pending', () => {
    const subscription = subscribe();
    subscription.applicationsNext(serverEmpty);
    expect(subscription.listener).toHaveBeenLastCalledWith({ clients: [], profilesState: 'pending' });
  });

  it('does not publish an empty first answer that came only from the cache', () => {
    const subscription = subscribe();
    subscription.applicationsNext(cacheEmpty);
    subscription.profilesNext(profiles);
    expect(subscription.listener).not.toHaveBeenCalled();

    subscription.applicationsNext(serverEmpty);
    expect(subscription.listener).toHaveBeenCalledExactlyOnceWith({
      clients: [expect.objectContaining({ id: 'borrower-1' })],
      profilesState: 'available',
    });
  });

  it('keeps profiles pending on an empty cache result until the server answers', () => {
    const subscription = subscribe();
    subscription.applicationsNext(applications);
    subscription.profilesNext(cacheEmpty);
    expect(subscription.listener).toHaveBeenCalledTimes(1);
    expect(subscription.listener).toHaveBeenLastCalledWith(expect.objectContaining({ profilesState: 'pending' }));

    subscription.profilesNext(serverEmpty);
    expect(subscription.listener).toHaveBeenLastCalledWith({
      clients: [expect.objectContaining({ id: 'borrower-1', profile: null })],
      profilesState: 'available',
    });
  });

  it('publishes a cached result that has data', () => {
    const subscription = subscribe();
    subscription.applicationsNext({ ...applications, metadata: { fromCache: true } });
    subscription.profilesNext({ ...profiles, metadata: { fromCache: true } });
    expect(subscription.listener).toHaveBeenLastCalledWith({
      clients: [expect.objectContaining({ profile: expect.objectContaining({ fullName: 'Alice Byrne' }) })],
      profilesState: 'available',
    });
  });

  it('still reports a failure when the first answer never arrives from the server', () => {
    const subscription = subscribe();
    subscription.applicationsNext(cacheEmpty);
    subscription.applicationsError({ code: 'unavailable' });
    expect(subscription.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(subscription.listener).not.toHaveBeenCalled();
  });

  it('asks for metadata changes so that an empty server answer after an empty cache is delivered', () => {
    const subscription = subscribe();
    expect(subscription.applicationsOptions).toEqual({ includeMetadataChanges: true });
    expect(subscription.profilesOptions).toEqual({ includeMetadataChanges: true });
  });

  it.each(['permission-denied', 'unavailable'])('handles profiles %s before applications answer', (code) => {
    const subscription = subscribe();
    subscription.profilesError({ code });
    expect(subscription.listener).not.toHaveBeenCalled();
    subscription.applicationsNext(applications);
    expect(subscription.listener).toHaveBeenLastCalledWith(expect.objectContaining({ profilesState: 'unavailable' }));
    expect(subscription.onError).not.toHaveBeenCalled();
  });

  it.each(['permission-denied', 'unavailable'])('handles profiles %s after applications answer', (code) => {
    const subscription = subscribe();
    subscription.applicationsNext(applications);
    subscription.profilesNext(profiles);
    subscription.profilesError({ code });
    expect(subscription.listener).toHaveBeenLastCalledWith({
      clients: [expect.objectContaining({ id: 'borrower-1', profile: null })],
      profilesState: 'unavailable',
    });
    expect(subscription.onError).not.toHaveBeenCalled();
  });

  it.each(['permission-denied', 'unavailable'])('stops both listeners on an applications %s error', (code) => {
    const subscription = subscribe();
    subscription.applicationsNext(applications);
    subscription.applicationsError({ code });
    expect(subscription.unsubscribeApplications).toHaveBeenCalledTimes(1);
    expect(subscription.unsubscribeProfiles).toHaveBeenCalledTimes(1);
    expect(subscription.onError).toHaveBeenCalledExactlyOnceWith(code);
    subscription.applicationsNext(applications);
    subscription.profilesNext(profiles);
    subscription.profilesError({ code });
    subscription.applicationsError({ code });
    expect(subscription.listener).toHaveBeenCalledTimes(1);
    expect(subscription.onError).toHaveBeenCalledTimes(1);
  });

  it('stop unsubscribes both listeners and ignores later callbacks', () => {
    const subscription = subscribe();
    subscription.stop();
    expect(subscription.unsubscribeApplications).toHaveBeenCalledTimes(1);
    expect(subscription.unsubscribeProfiles).toHaveBeenCalledTimes(1);
    subscription.applicationsNext(applications);
    subscription.profilesNext(profiles);
    subscription.profilesError({ code: 'permission-denied' });
    subscription.applicationsError({ code: 'unavailable' });
    expect(subscription.listener).not.toHaveBeenCalled();
    expect(subscription.onError).not.toHaveBeenCalled();
  });
});
