import { createContext, useContext, useEffect, useState } from 'react';
import {
  firestoreCommitteeService, type CommitteeService, type CommitteeState, type CommitteeCallsState,
  type CommitteeViewer,
} from '../services/committeeService';
import { useAuth } from './AuthContext';

// Like LoanFileServiceContext, the production default is replaceable with a fake in tests.
export const CommitteeServiceContext = createContext<CommitteeService>(firestoreCommitteeService);

type Subscribe<T> = (service: CommitteeService, id: string, viewer: CommitteeViewer, listener: (state: T) => void) => () => void;

function useCommitteeSubscription<T>(id: string, subscribe: Subscribe<T>, loading: T): T {
  const service = useContext(CommitteeServiceContext);
  const { user, role } = useAuth();
  const uid = user?.uid;
  const key = `${uid ?? ''}\u0000${role ?? ''}\u0000${id}`;
  const [current, setCurrent] = useState<{ key: string; state: T }>({ key, state: loading });

  useEffect(() => {
    let active = true;
    setCurrent({ key, state: loading });
    if (!uid || (role !== 'broker' && role !== 'underwriter')) return;
    const receive = (state: T) => {
      if (active) setCurrent({ key, state });
    };
    const stop = subscribe(service, id, { uid, role }, receive);
    return () => {
      active = false;
      stop();
    };
  }, [service, id, uid, role, key, subscribe, loading]);

  return current.key === key ? current.state : loading;
}

const RUN_LOADING: CommitteeState = { status: 'loading' };
const CALLS_LOADING: CommitteeCallsState = { status: 'loading' };
const subscribeToRun: Subscribe<CommitteeState> = (service, id, viewer, listener) => service.subscribeToRun(id, viewer, listener);
const subscribeToCalls: Subscribe<CommitteeCallsState> = (service, id, viewer, listener) => service.subscribeToCalls(id, viewer, listener);

export function useCommittee(applicationId: string): CommitteeState {
  return useCommitteeSubscription(applicationId, subscribeToRun, RUN_LOADING);
}

export function useCommitteeCalls(runId: string): CommitteeCallsState {
  return useCommitteeSubscription(runId, subscribeToCalls, CALLS_LOADING);
}
