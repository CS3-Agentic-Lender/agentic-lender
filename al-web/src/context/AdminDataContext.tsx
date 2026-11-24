import { createContext, useCallback, useContext } from 'react';
import { useLive } from '../hooks/useLive';
import {
  firestoreAdminActivityService,
  type AdminAction,
  type AdminActivityService,
} from '../services/adminActivityService';
import { createInboxService, type InboxService, type Review, type SupportRequest } from '../services/inboxService';
import { firestoreBusinessService, type BusinessService } from '../services/businessService';
import type { CommitteeRun } from '../services/committeeService';
import type { LiveErrorListener, LiveListener } from '../services/liveCollection';
import type { LoanFileApplication } from '../services/loanFileService';
import {
  firestoreUserDirectoryService,
  type DirectoryUser,
  type UserDirectoryService,
} from '../services/userDirectoryService';

// The admin pages' Firestore reads, injectable so tests can drive them.
export const AdminActivityServiceContext = createContext<AdminActivityService>(firestoreAdminActivityService);
export const InboxServiceContext = createContext<InboxService>(createInboxService());
export const BusinessServiceContext = createContext<BusinessService>(firestoreBusinessService);
export const UserDirectoryServiceContext = createContext<UserDirectoryService>(firestoreUserDirectoryService);

export function useUsers() {
  const service = useContext(UserDirectoryServiceContext);
  return useLive(
    useCallback(
      (listener: LiveListener<DirectoryUser>, onError: LiveErrorListener) => service.subscribeToUsers(listener, onError),
      [service],
    ),
  );
}

export function useRecentActivity() {
  const service = useContext(AdminActivityServiceContext);
  return useLive(
    useCallback(
      (listener: LiveListener<AdminAction>, onError: LiveErrorListener) =>
        service.subscribeToRecentActivity(listener, onError),
      [service],
    ),
  );
}

export function useSupportRequests() {
  const service = useContext(InboxServiceContext);
  return useLive(
    useCallback(
      (listener: LiveListener<SupportRequest>, onError: LiveErrorListener) =>
        service.subscribeToSupportRequests(listener, onError),
      [service],
    ),
  );
}

export function useReviews() {
  const service = useContext(InboxServiceContext);
  return useLive(
    useCallback(
      (listener: LiveListener<Review>, onError: LiveErrorListener) => service.subscribeToReviews(listener, onError),
      [service],
    ),
  );
}

export function useApplications() {
  const service = useContext(BusinessServiceContext);
  return useLive(
    useCallback(
      (listener: LiveListener<LoanFileApplication>, onError: LiveErrorListener) =>
        service.subscribeToApplications(listener, onError),
      [service],
    ),
  );
}

export function useRuns() {
  const service = useContext(BusinessServiceContext);
  return useLive(
    useCallback(
      (listener: LiveListener<CommitteeRun>, onError: LiveErrorListener) => service.subscribeToRuns(listener, onError),
      [service],
    ),
  );
}
