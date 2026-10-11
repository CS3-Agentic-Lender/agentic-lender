import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  firestorePipelineService,
  type PipelineApplication,
  type PipelineService,
} from '../services/pipelineService';
import { useAuth } from './AuthContext';

export type PipelineState =
  | { status: 'loading' }
  | { status: 'ready'; applications: PipelineApplication[]; riskTiersAvailable: boolean }
  | { status: 'denied' }
  | { status: 'error' };

export const PipelineServiceContext = createContext<PipelineService>(firestorePipelineService);

const PipelineContext = createContext<PipelineState | null>(null);

interface PipelineProviderProps {
  children: ReactNode;
}

export function PipelineProvider({ children }: PipelineProviderProps) {
  const service = useContext(PipelineServiceContext);
  const { user } = useAuth();
  const underwriterUid = user?.uid ?? null;
  const [state, setState] = useState<PipelineState>({ status: 'loading' });

  useEffect(() => {
    // Drop the previous session's applications before the next subscription answers.
    setState({ status: 'loading' });

    if (!underwriterUid) {
      return;
    }

    return service.subscribeToPipeline(
      (snapshot) => setState({ status: 'ready', ...snapshot }),
      (error) => setState({ status: error === 'permission-denied' ? 'denied' : 'error' }),
    );
  }, [service, underwriterUid]);

  return <PipelineContext.Provider value={state}>{children}</PipelineContext.Provider>;
}

export function usePipeline() {
  const context = useContext(PipelineContext);

  if (!context) {
    throw new Error('usePipeline must be used inside PipelineProvider.');
  }

  return context;
}
