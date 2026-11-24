import { createContext, useContext } from 'react';
import { apiStressService, type StressService } from '../services/stressService';

// Like DecisionServiceContext, production has a default and tests provide a fake service.
export const StressServiceContext = createContext<StressService>(apiStressService);

export function useStressService() {
  return useContext(StressServiceContext);
}
