import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  byRoleThenName,
  createStaffService,
  staffFailureMessage,
  type StaffMember,
  type StaffService,
} from '../services/staffService';

export type StaffState =
  | { status: 'loading' }
  | { status: 'ready'; staff: StaffMember[] }
  | { status: 'error'; message: string };

interface StaffContextValue {
  state: StaffState;
  service: StaffService;
  reload(): void;
  // Put an account the API just returned into the list, replacing any older copy.
  upsert(member: StaffMember): void;
  drop(uid: string): void;
}

export const StaffServiceContext = createContext<StaffService>(createStaffService());

const StaffContext = createContext<StaffContextValue | null>(null);

// The staff list, loaded once for the admin pages and kept current from each change's response,
// so the dashboard's counts and the staff page agree without a second request.
export function StaffProvider({ children }: { children: ReactNode }) {
  const service = useContext(StaffServiceContext);
  const [state, setState] = useState<StaffState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    service.list().then(
      (staff) => active && setState({ status: 'ready', staff }),
      (error: unknown) => active && setState({ status: 'error', message: staffFailureMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [service, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const upsert = useCallback((member: StaffMember) => {
    setState((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            staff: [...current.staff.filter((entry) => entry.uid !== member.uid), member].sort(byRoleThenName),
          }
        : current,
    );
  }, []);

  const drop = useCallback((uid: string) => {
    setState((current) =>
      current.status === 'ready' ? { status: 'ready', staff: current.staff.filter((entry) => entry.uid !== uid) } : current,
    );
  }, []);

  const value = useMemo(() => ({ state, service, reload, upsert, drop }), [state, service, reload, upsert, drop]);

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

export function useStaff() {
  const context = useContext(StaffContext);

  if (!context) {
    throw new Error('useStaff must be used inside StaffProvider.');
  }

  return context;
}
