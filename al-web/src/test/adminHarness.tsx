import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timestamp, type DocumentData } from 'firebase/firestore';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { expect, vi } from 'vitest';
import { AuthProvider } from '../context/AuthContext';
import {
  AdminActivityServiceContext,
  BusinessServiceContext,
  InboxServiceContext,
  UserDirectoryServiceContext,
} from '../context/AdminDataContext';
import { CommitteeServiceContext } from '../context/CommitteeContext';
import { LoanFileServiceContext } from '../context/LoanFileContext';
import { StaffServiceContext } from '../context/StaffContext';
import { AppRoutes } from '../routes';
import { ApiError } from '../services/apiClient';
import type { AdminAction, AdminActivityService } from '../services/adminActivityService';
import type { AuthService, AuthStateListener, AuthUser, TrustedRole } from '../services/authService';
import type { BusinessService } from '../services/businessService';
import {
  toCommitteeRun,
  type CommitteeCallsState,
  type CommitteeRun,
  type CommitteeService,
  type CommitteeState,
  type CommitteeViewer,
} from '../services/committeeService';
import type { InboxService, Review, SupportNote, SupportRequest } from '../services/inboxService';
import type { LiveError, LiveErrorListener, LiveListener } from '../services/liveCollection';
import {
  toLoanFileApplication,
  type LoanFileApplication,
  type LoanFileListener,
  type LoanFileService,
  type LoanFileUpdate,
} from '../services/loanFileService';
import type { NewStaffMember, StaffChange, StaffMember, StaffService } from '../services/staffService';
import type { DirectoryUser, UserDirectoryService } from '../services/userDirectoryService';

// The admin pages are a lazy chunk. Loading it once here keeps its first import, which is slow when
// the whole suite runs in parallel, out of every test's findBy timeout.
await import('../pages/admin/AdminApp');

export const ADMIN_UID = 'admin1';

// A panel still loading: its label is a status for screen readers, inside a region marked busy.
export async function expectLoading(label: string) {
  const status = await screen.findByText(label);
  expect(status).toHaveAttribute('role', 'status');
  expect(status.closest('[aria-busy="true"]')).not.toBeNull();
}

export class FakeAuthService implements AuthService {
  private listener: AuthStateListener | null = null;

  constructor(
    private readonly user: AuthUser,
    private readonly role: TrustedRole,
  ) {}

  subscribe(listener: AuthStateListener) {
    this.listener = listener;
    listener(this.user);
    return () => {
      this.listener = null;
    };
  }

  async signIn() {}

  async signOut() {
    this.listener?.(null);
  }

  async resolveTrustedRole() {
    return { role: this.role, denialReason: null };
  }

  async getCurrentIdToken() {
    return 'id-token';
  }
}

export function authUser(uid: string): AuthUser {
  return {
    uid,
    email: `${uid}@example.test`,
    getIdToken: async () => 'id-token',
    getIdTokenResult: async () => ({ claims: {} }) as never,
  };
}

// A live Firestore list the test controls: it answers each new subscriber with `items` (when set),
// and `emit` or `fail` reach every subscriber still listening.
export class FakeLive<T> {
  private readonly listeners = new Set<{ listener: LiveListener<T>; onError: LiveErrorListener }>();

  constructor(public items: T[] | null = []) {}

  subscribe = (listener: LiveListener<T>, onError: LiveErrorListener) => {
    const entry = { listener, onError };
    this.listeners.add(entry);
    if (this.items !== null) {
      listener(this.items);
    }
    return () => {
      this.listeners.delete(entry);
    };
  };

  emit(items: T[]) {
    this.items = items;
    this.listeners.forEach(({ listener }) => listener(items));
  }

  fail(error: LiveError) {
    this.listeners.forEach(({ onError }) => onError(error));
  }

  get active() {
    return this.listeners.size;
  }
}

export class FakeActivityService implements AdminActivityService {
  constructor(readonly live = new FakeLive<AdminAction>()) {}

  subscribeToRecentActivity = (listener: LiveListener<AdminAction>, onError: LiveErrorListener) =>
    this.live.subscribe(listener, onError);
}

// The inbox API records each call and answers like al-core (closed or reopened by the signed-in admin at
// `now`, with no sender; a note saved with the next id), or with the error queued for that call. It never
// touches the live lists: a test emits those. Each request's notes are their own live list, in `notes`.
export class FakeInboxService implements InboxService {
  readonly closed: Array<{ reference: string; resolution: string | undefined }> = [];
  readonly reopened: string[] = [];
  readonly added: Array<{ reference: string; text: string }> = [];
  readonly notes = new Map<string, FakeLive<SupportNote>>();
  closeError: unknown = null;
  reopenError: unknown = null;
  noteError: unknown = null;
  closedAt = new Date('2026-11-24T12:30:00Z');

  constructor(
    readonly requests = new FakeLive<SupportRequest>(),
    readonly reviews = new FakeLive<Review>(),
  ) {}

  subscribeToSupportRequests = (listener: LiveListener<SupportRequest>, onError: LiveErrorListener) =>
    this.requests.subscribe(listener, onError);

  subscribeToReviews = (listener: LiveListener<Review>, onError: LiveErrorListener) =>
    this.reviews.subscribe(listener, onError);

  notesOf(reference: string) {
    if (!this.notes.has(reference)) this.notes.set(reference, new FakeLive<SupportNote>([]));
    return this.notes.get(reference)!;
  }

  subscribeToSupportNotes = (reference: string, listener: LiveListener<SupportNote>, onError: LiveErrorListener) =>
    this.notesOf(reference).subscribe(listener, onError);

  private current(reference: string) {
    const current = this.requests.items?.find((request) => request.reference === reference);
    if (!current) throw new ApiError('http', `No support request with reference ${reference}`, 404);
    return current;
  }

  async closeSupportRequest(reference: string, resolution?: string): Promise<SupportRequest> {
    this.closed.push({ reference, resolution });
    if (this.closeError) throw this.closeError;
    const current = this.current(reference);
    return current.status === 'closed'
      ? { ...current, userId: null }
      : {
          ...current,
          userId: null,
          status: 'closed',
          closedAt: this.closedAt,
          closedBy: ADMIN_UID,
          resolution: resolution?.trim() || null,
        };
  }

  async reopenSupportRequest(reference: string): Promise<SupportRequest> {
    this.reopened.push(reference);
    if (this.reopenError) throw this.reopenError;
    const current = this.current(reference);
    return { ...current, userId: null, status: 'open', closedAt: null, closedBy: null, resolution: null };
  }

  async addSupportNote(reference: string, text: string): Promise<SupportNote> {
    this.added.push({ reference, text });
    if (this.noteError) throw this.noteError;
    this.current(reference);
    return { id: `note-${this.added.length}`, authorUid: ADMIN_UID, text: text.trim(), createdAt: this.closedAt };
  }
}

export class FakeUserDirectoryService implements UserDirectoryService {
  constructor(readonly live = new FakeLive<DirectoryUser>(seededUsers())) {}

  subscribeToUsers = (listener: LiveListener<DirectoryUser>, onError: LiveErrorListener) =>
    this.live.subscribe(listener, onError);
}

export function directoryUser(overrides: Partial<DirectoryUser> & Pick<DirectoryUser, 'uid'>): DirectoryUser {
  return {
    role: 'borrower',
    fullName: `Person ${overrides.uid}`,
    email: `${overrides.uid}@test.com`,
    firm: null,
    brokerId: null,
    disabled: false,
    createdAt: new Date('2026-09-20T09:00:00Z'),
    ...overrides,
  };
}

// The emulator seed's users/{uid} profiles (al-core/scripts/demo-users.js).
export function seededUsers(): DirectoryUser[] {
  return [
    directoryUser({ uid: 'borrower1', fullName: 'Alice Byrne', email: 'alice@test.com', brokerId: 'broker1' }),
    directoryUser({ uid: 'borrower2', fullName: 'Ben Walsh', email: 'ben@test.com', brokerId: 'broker2' }),
    directoryUser({ uid: 'broker1', role: 'broker', fullName: 'Bob Murphy', email: 'bob@test.com', firm: 'Murphy Mortgages' }),
    directoryUser({ uid: 'broker2', role: 'broker', fullName: 'Ciara Kelly', email: 'ciara@test.com', firm: 'Kelly Financial' }),
    directoryUser({ uid: 'underwriter1', role: 'underwriter', fullName: 'Uma Nolan', email: 'uma@test.com' }),
    directoryUser({ uid: ADMIN_UID, role: 'admin', fullName: 'Ada Admin', email: 'admin@test.com' }),
  ];
}

// The staff API as a test double: it records each call and answers from `staff`, or with the error
// queued for that call.
export class FakeStaffService implements StaffService {
  readonly created: NewStaffMember[] = [];
  readonly updates: Array<{ uid: string; change: StaffChange }> = [];
  readonly removed: string[] = [];
  readonly emails: string[] = [];
  listError: unknown = null;
  createError: unknown = null;
  updateError: unknown = null;
  removeError: unknown = null;
  emailError: unknown = null;
  listCalls = 0;

  constructor(public staff: StaffMember[] = []) {}

  async list() {
    this.listCalls += 1;
    if (this.listError) throw this.listError;
    return [...this.staff];
  }

  async create(member: NewStaffMember) {
    this.created.push(member);
    if (this.createError) throw this.createError;
    const created = staffMember({
      uid: `new-${this.created.length}`,
      fullName: member.fullName,
      email: member.email.toLowerCase(),
      phone: member.phone,
      role: member.role,
      firm: member.firm,
    });
    this.staff.push(created);
    return created;
  }

  async update(uid: string, change: StaffChange) {
    this.updates.push({ uid, change });
    if (this.updateError) throw this.updateError;
    const current = this.staff.find((member) => member.uid === uid)!;
    const updated: StaffMember =
      'disabled' in change
        ? { ...current, enabled: !change.disabled }
        : { ...current, role: change.role, firm: change.role === 'broker' ? change.firm : null };
    this.staff = this.staff.map((member) => (member.uid === uid ? updated : member));
    return updated;
  }

  async remove(uid: string) {
    this.removed.push(uid);
    if (this.removeError) throw this.removeError;
    this.staff = this.staff.filter((member) => member.uid !== uid);
  }

  async sendSetPasswordEmail(email: string) {
    this.emails.push(email);
    if (this.emailError) throw this.emailError;
  }
}

export function staffMember(overrides: Partial<StaffMember> & Pick<StaffMember, 'uid'>): StaffMember {
  return {
    fullName: `Person ${overrides.uid}`,
    email: `${overrides.uid}@test.com`,
    role: 'broker',
    firm: null,
    phone: '+353871234500',
    enabled: true,
    createdAt: new Date('2026-09-01T09:00:00Z'),
    ...overrides,
  };
}

// The emulator seed's staff, as GET /core/admin/staff lists them.
export function seededStaff(): StaffMember[] {
  return [
    staffMember({ uid: ADMIN_UID, fullName: 'Ada Admin', email: 'admin@test.com', role: 'admin' }),
    staffMember({ uid: 'broker1', fullName: 'Bob Murphy', email: 'bob@test.com', role: 'broker', firm: 'Murphy Mortgages' }),
    staffMember({ uid: 'broker2', fullName: 'Ciara Kelly', email: 'ciara@test.com', role: 'broker', firm: 'Kelly Financial' }),
    staffMember({ uid: 'underwriter1', fullName: 'Uma Nolan', email: 'uma@test.com', role: 'underwriter' }),
  ];
}

export function at(iso: string) {
  return Timestamp.fromDate(new Date(iso));
}

// An application as an admin reads it, parsed from stored fields like the live list parses it.
export function businessApplication(id: string, data: DocumentData = {}): LoanFileApplication {
  return toLoanFileApplication(id, {
    status: 'Applied',
    loanType: 'mortgage',
    borrowerName: `Borrower of ${id}`,
    borrowerId: 'borrower1',
    brokerId: 'broker1',
    loanAmountEur: 250000,
    createdAt: at('2026-11-10T10:00:00Z'),
    ...data,
  });
}

export function committeeRun(id: string, data: DocumentData = {}): CommitteeRun {
  return toCommitteeRun(id, { applicationId: 'LN-1', status: 'complete', trigger: 'submit', ...data });
}

export class FakeBusinessService implements BusinessService {
  constructor(
    readonly applications = new FakeLive<LoanFileApplication>([]),
    readonly runs = new FakeLive<CommitteeRun>([]),
  ) {}

  subscribeToApplications = (listener: LiveListener<LoanFileApplication>, onError: LiveErrorListener) =>
    this.applications.subscribe(listener, onError);

  subscribeToRuns = (listener: LiveListener<CommitteeRun>, onError: LiveErrorListener) =>
    this.runs.subscribe(listener, onError);
}

// Answers each loan file subscription with the file stored for its application ID, if any.
export class FakeLoanFileService implements LoanFileService {
  constructor(readonly files: Record<string, LoanFileUpdate> = {}) {}

  subscribeToLoanFile(applicationId: string, listener: LoanFileListener) {
    const file = this.files[applicationId];
    if (file) listener(file);
    return () => {};
  }
}

// Answers with one committee run and no calls, and records who asked.
export class FakeCommitteeService implements CommitteeService {
  readonly viewers: CommitteeViewer[] = [];

  constructor(readonly run: CommitteeState = { status: 'missing' }) {}

  subscribeToRun = (_applicationId: string, viewer: CommitteeViewer, listener: (state: CommitteeState) => void) => {
    this.viewers.push(viewer);
    listener(this.run);
    return () => {};
  };

  subscribeToCalls = (_runId: string, _viewer: CommitteeViewer, listener: (state: CommitteeCallsState) => void) => {
    listener({ status: 'ready', calls: [] });
    return () => {};
  };
}

export interface AdminFakes {
  staff: FakeStaffService;
  activity: FakeActivityService;
  inbox: FakeInboxService;
  users: FakeUserDirectoryService;
  business: FakeBusinessService;
  loanFiles: FakeLoanFileService;
  committee: FakeCommitteeService;
}

export function adminFakes(overrides: Partial<AdminFakes> = {}): AdminFakes {
  return {
    staff: overrides.staff ?? new FakeStaffService(seededStaff()),
    activity: overrides.activity ?? new FakeActivityService(),
    inbox: overrides.inbox ?? new FakeInboxService(),
    users: overrides.users ?? new FakeUserDirectoryService(),
    business: overrides.business ?? new FakeBusinessService(),
    loanFiles: overrides.loanFiles ?? new FakeLoanFileService(),
    committee: overrides.committee ?? new FakeCommitteeService(),
  };
}

export function AdminServices({ fakes, children }: { fakes: AdminFakes; children: ReactNode }) {
  return (
    <StaffServiceContext.Provider value={fakes.staff}>
      <AdminActivityServiceContext.Provider value={fakes.activity}>
        <InboxServiceContext.Provider value={fakes.inbox}>
          <UserDirectoryServiceContext.Provider value={fakes.users}>
            <BusinessServiceContext.Provider value={fakes.business}>
              <LoanFileServiceContext.Provider value={fakes.loanFiles}>
                <CommitteeServiceContext.Provider value={fakes.committee}>{children}</CommitteeServiceContext.Provider>
              </LoanFileServiceContext.Provider>
            </BusinessServiceContext.Provider>
          </UserDirectoryServiceContext.Provider>
        </InboxServiceContext.Provider>
      </AdminActivityServiceContext.Provider>
    </StaffServiceContext.Provider>
  );
}

// The whole portal at `path`, signed in as `role` (an admin by default), with every admin service faked.
export function renderAdmin(
  path: string,
  { role = 'admin', uid = ADMIN_UID, ...overrides }: Partial<AdminFakes> & { role?: TrustedRole; uid?: string } = {},
) {
  const fakes = adminFakes(overrides);
  const user = userEvent.setup();
  const view = render(
    <AuthProvider resetSession={vi.fn()} service={new FakeAuthService(authUser(uid), role)}>
      <AdminServices fakes={fakes}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AdminServices>
    </AuthProvider>,
  );

  return { ...fakes, user, view };
}
