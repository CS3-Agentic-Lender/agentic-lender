import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  firestoreClientsService,
  type BrokerClientsSnapshot,
  type ClientsService,
} from '../services/clientsService';
import { useAuth } from './AuthContext';

export type BrokerClientsState =
  | { status: 'loading' }
  | ({ status: 'ready' } & BrokerClientsSnapshot)
  | { status: 'denied' }
  | { status: 'error' };

export const ClientsServiceContext = createContext<ClientsService>(firestoreClientsService);

// With Firestore unreachable neither an answer nor an error arrives, so the page would say
// "Loading" for good. After this long it says the files could not be loaded; a late answer still
// replaces that.
export const CLIENTS_LOAD_TIMEOUT_MS = 15_000;

const BrokerClientsContext = createContext<BrokerClientsState | null>(null);

interface BrokerClientsProviderProps {
  children: ReactNode;
}

export function BrokerClientsProvider({ children }: BrokerClientsProviderProps) {
  const service = useContext(ClientsServiceContext);
  const { user } = useAuth();
  const brokerUid = user?.uid ?? null;
  const [state, setState] = useState<BrokerClientsState>({ status: 'loading' });

  useEffect(() => {
    // Drop the previous broker's files before the next subscription answers.
    setState({ status: 'loading' });

    if (!brokerUid) {
      return;
    }

    let answered = false;
    const timeout = setTimeout(() => {
      if (!answered) {
        setState({ status: 'error' });
      }
    }, CLIENTS_LOAD_TIMEOUT_MS);

    const unsubscribe = service.subscribeToBrokerClients(
      brokerUid,
      (snapshot) => {
        answered = true;
        setState({ status: 'ready', ...snapshot });
      },
      (error) => {
        answered = true;
        setState({ status: error === 'permission-denied' ? 'denied' : 'error' });
      },
    );

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [service, brokerUid]);

  return <BrokerClientsContext.Provider value={state}>{children}</BrokerClientsContext.Provider>;
}

export function useBrokerClients() {
  const context = useContext(BrokerClientsContext);

  if (!context) {
    throw new Error('useBrokerClients must be used inside BrokerClientsProvider.');
  }

  return context;
}
