import { createContext, useContext } from 'react';
import { apiSettlementService, type SettlementService } from '../services/settlementService';

export const SettlementServiceContext = createContext<SettlementService>(apiSettlementService);

export function useSettlementService() {
  return useContext(SettlementServiceContext);
}
