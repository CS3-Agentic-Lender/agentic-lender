import { onSnapshot } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firestoreClientsService } from './clientsService';

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  onSnapshot: vi.fn(),
}));

const applications = {
  docs: [{ id: 'LN-1001', data: () => ({ borrowerId: 'borrower-1', status: 'Applied' }) }],
};
const profiles = {
  docs: [{ id: 'borrower-1', data: () => ({ fullName: 'Alice Byrne' }) }],
};

function subscribe() {
  const listener = vi.fn();
  const onError = vi.fn();
  const unsubscribeApplications = vi.fn();
  const unsubscribeProfiles = vi.fn();
  vi.mocked(onSnapshot)
    .mockReturnValueOnce(unsubscribeApplications)
    .mockReturnValueOnce(unsubscribeProfiles);
  const stop = firestoreClientsService.subscribeToBrokerClients('broker-1', listener, onError);
  const callbacks = vi.mocked(onSnapshot).mock.calls as unknown as Array<[
    unknown,
    (snapshot: { docs: Array<{ id: string; data: () => Record<string, string> }> }) => void,
    (error: { code: string }) => void,
  ]>;

  return {
    listener,
    onError,
    stop,
    unsubscribeApplications,
    unsubscribeProfiles,
    applicationsNext: callbacks[0][1],
    applicationsError: callbacks[0][2],
    profilesNext: callbacks[1][1],
    profilesError: callbacks[1][2],
  };
}

beforeEach(() => vi.mocked(onSnapshot).mockReset());

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
    subscription.applicationsNext({ docs: [] });
    expect(subscription.listener).toHaveBeenLastCalledWith({ clients: [], profilesState: 'pending' });
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
