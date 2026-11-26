import { createContext, useContext } from 'react';
import { firestoreOverviewService, type OverviewService } from '../services/overviewService';

// Production listens to Firestore; tests provide a fake.
export const OverviewServiceContext = createContext<OverviewService>(firestoreOverviewService);

export function useOverviewService() {
  return useContext(OverviewServiceContext);
}
