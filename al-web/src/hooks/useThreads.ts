import { useEffect, useState } from 'react';
import { useMessagesService } from '../context/MessagesContext';
import type { ThreadSnapshot } from '../services/messagesService';

export interface ThreadsState {
  threads: ReadonlyMap<string, ThreadSnapshot>;
  // Threads that could not be read. They stay out of the counts; opening one shows the error.
  failed: ReadonlySet<string>;
}

// Listens to every given thread, so unread counts and the order update live.
export function useThreads(applicationIds: string[], uid: string | null): ThreadsState {
  const service = useMessagesService();
  const [state, setState] = useState<ThreadsState>({ threads: new Map(), failed: new Set() });
  const key = applicationIds.join('|');

  useEffect(() => {
    setState({ threads: new Map(), failed: new Set() });
    if (!uid) {
      return;
    }
    const stops = applicationIds.map((applicationId) =>
      service.subscribeToThread(
        applicationId,
        uid,
        (snapshot) =>
          setState((current) => ({ ...current, threads: new Map(current.threads).set(applicationId, snapshot) })),
        () => setState((current) => ({ ...current, failed: new Set(current.failed).add(applicationId) })),
      ),
    );
    return () => stops.forEach((stop) => stop());
    // The ids are compared by value through `key`, so a new array with the same ids keeps the listeners.
  },[service, uid, key]);

  return state;
}
