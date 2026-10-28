import { createContext, useContext, useEffect, useState } from 'react';
import {
  firestoreLoanFileService,
  type LoanFileApplication,
  type LoanFileReview,
  type LoanFileService,
} from '../services/loanFileService';
import { useAuth } from './AuthContext';

export type LoanFileState =
  | { status: 'loading' }
  | { status: 'ready'; application: LoanFileApplication; review: LoanFileReview }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'error' };

export const LoanFileServiceContext = createContext<LoanFileService>(firestoreLoanFileService);

interface KeyedState {
  key: string;
  state: LoanFileState;
}

const LOADING: LoanFileState = { status: 'loading' };

// One live loan file for the signed-in user. The listeners are stopped and replaced whenever the
// application or the user changes, and on unmount.
export function useLoanFile(applicationId: string | undefined): LoanFileState {
  const service = useContext(LoanFileServiceContext);
  const { user, role } = useAuth();
  const uid = user?.uid ?? null;
  const key = `${uid ?? ''}\u0000${role ?? ''}\u0000${applicationId ?? ''}`;
  const [current, setCurrent] = useState<KeyedState>({ key, state: LOADING });

  useEffect(() => {
    setCurrent({ key, state: LOADING });

    if (!uid || applicationId === undefined) {
      return;
    }

    return service.subscribeToLoanFile(
      applicationId,
      (update) => {
        // The rules already refuse another broker's application; this keeps the page honest if
        // a document is ever readable without being this broker's.
        if (update.status === 'ready' && role === 'broker' && update.application.brokerId !== uid) {
          setCurrent({ key, state: { status: 'forbidden' } });
          return;
        }

        setCurrent({ key, state: update });
      },
      (error) => setCurrent({ key, state: { status: error === 'forbidden' ? 'forbidden' : 'error' } }),
    );
  }, [service, key, uid, role, applicationId]);

  // A result for a previous application or user is never shown under the new one, not even for
  // the render before the effect above replaces it.
  return current.key === key ? current.state : LOADING;
}
