import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { LiveErrorListener, LiveListener } from '../services/liveCollection';

export type LiveState<T> =
  | { status: 'loading' }
  | { status: 'ready'; items: T[] }
  | { status: 'denied' }
  | { status: 'error' };

const LOADING = { status: 'loading' } as const;

// A live list for the signed-in user. The subscription restarts when the user or `subscribe` changes,
// so pass a stable function (a service method bound once, or one built with useCallback).
export function useLive<T>(
  subscribe: (listener: LiveListener<T>, onError: LiveErrorListener) => () => void,
): LiveState<T> {
  const uid = useAuth().user?.uid ?? null;
  const [state, setState] = useState<LiveState<T>>(LOADING);

  useEffect(() => {
    setState(LOADING);

    if (!uid) {
      return;
    }

    return subscribe(
      (items) => setState({ status: 'ready', items }),
      (error) => setState({ status: error === 'permission-denied' ? 'denied' : 'error' }),
    );
  }, [subscribe, uid]);

  return state;
}
