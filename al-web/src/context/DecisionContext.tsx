import { createContext, useContext } from 'react';
import { apiDecisionService, type DecisionService } from '../services/decisionService';

// Like LoanFileServiceContext, production has a default and tests provide a fake service.
export const DecisionServiceContext = createContext<DecisionService>(apiDecisionService);

export function useDecisionService() {
  return useContext(DecisionServiceContext);
}
