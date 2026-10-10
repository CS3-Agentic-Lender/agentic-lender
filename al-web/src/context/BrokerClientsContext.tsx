import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  firestoreClientsService,
  type BrokerClient,
  type ClientsService,
} from '../services/clientsService';
import { useAuth } from './AuthContext';

export type BrokerClientsState =
  | { status: 'loading' }
  | { status: 'ready'; clients: BrokerClient[]; profilesAvailable: boolean }
  | { status: 'denied' }
  | { status: 'error' };

export const ClientsServiceContext = createContext<ClientsService>(firestoreClientsService);

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

    return service.subscribeToBrokerClients(
      brokerUid,
      (snapshot) => setState({ status: 'ready', ...snapshot }),
      (error) => setState({ status: error === 'permission-denied' ? 'denied' : 'error' }),
    );
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
