import { createContext, useContext } from 'react';
import { apiAuditPackService, type AuditPackService } from '../services/auditPackService';

// Like the decision and settlement services, production has a default and tests provide a fake.
export const AuditPackServiceContext = createContext<AuditPackService>(apiAuditPackService);

export function useAuditPackService() {
  return useContext(AuditPackServiceContext);
}
