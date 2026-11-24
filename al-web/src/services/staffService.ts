import { sendPasswordResetEmail } from 'firebase/auth';
import { ApiError, createApiClient, type ApiClient } from './apiClient';
import { auth } from './firebase';

// Admins are listed but made only by script (AL-337, agreed 24 Nov): the portal manages the other two.
export const STAFF_ROLES = ['admin', 'broker', 'underwriter'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type ManagedRole = Exclude<StaffRole, 'admin'>;

export const staffRoleLabels: Record<StaffRole, string> = {
  admin: 'Admin',
  broker: 'Broker',
  underwriter: 'Underwriter',
};

export interface StaffMember {
  uid: string;
  fullName: string;
  email: string;
  role: StaffRole;
  firm: string | null;
  phone: string | null;
  enabled: boolean;
  createdAt: Date | null;
}

export interface NewStaffMember {
  fullName: string;
  email: string;
  phone: string;
  role: ManagedRole;
  firm: string | null;
}

// What PATCH /core/admin/staff/{uid} accepts: a firm goes with, and only with, a move to broker.
export type StaffChange =
  | { disabled: boolean }
  | { role: 'underwriter' }
  | { role: 'broker'; firm: string };

export interface StaffService {
  list(): Promise<StaffMember[]>;
  create(member: NewStaffMember): Promise<StaffMember>;
  update(uid: string, change: StaffChange): Promise<StaffMember>;
  remove(uid: string): Promise<void>;
  // Firebase emails the person a link to set their own password; no password passes through the admin.
  sendSetPasswordEmail(email: string): Promise<void>;
}

export function isManagedRole(role: StaffRole): role is ManagedRole {
  return role !== 'admin';
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function isStaffRole(value: unknown): value is StaffRole {
  return STAFF_ROLES.some((role) => role === value);
}

// An account the portal cannot place (no uid, an unknown role) is not shown rather than shown wrongly.
export function toStaffMember(raw: unknown): StaffMember | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const uid = text(record.uid);

  if (!uid || !isStaffRole(record.role)) {
    return null;
  }

  const created = text(record.created_at);
  const createdAt = created ? new Date(created) : null;

  return {
    uid,
    fullName: text(record.full_name) ?? 'Name not stored',
    email: text(record.email) ?? '',
    role: record.role,
    firm: text(record.firm),
    phone: text(record.phone),
    enabled: record.enabled !== false,
    createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
  };
}

function requireStaffMember(raw: unknown) {
  const member = toStaffMember(raw);

  if (!member) {
    throw new ApiError('response', 'The server returned an unreadable staff account. Reload the page to see it.');
  }

  return member;
}

const roleOrder: Record<StaffRole, number> = { admin: 0, broker: 1, underwriter: 2 };

// The API's own order (admins, then brokers, then underwriters, each by name), kept after local changes.
export function byRoleThenName(a: StaffMember, b: StaffMember) {
  return roleOrder[a.role] - roleOrder[b.role] || a.fullName.localeCompare(b.fullName) || a.uid.localeCompare(b.uid);
}

const BASE = '/core/admin/staff';

function memberPath(uid: string) {
  return `${BASE}/${encodeURIComponent(uid)}`;
}

export function createStaffService(
  client: ApiClient = createApiClient(),
  sendResetEmail: (email: string) => Promise<void> = (email) => sendPasswordResetEmail(auth, email),
): StaffService {
  return {
    async list() {
      const body = await client.request<unknown>(BASE, { method: 'GET' });

      if (!Array.isArray(body)) {
        throw new ApiError('response', 'The server returned an unreadable staff list. Reload the page to try again.');
      }

      return body.map(toStaffMember).filter((member) => member !== null).sort(byRoleThenName);
    },

    async create(member) {
      const body = await client.request<unknown>(BASE, {
        method: 'POST',
        body: {
          full_name: member.fullName,
          email: member.email,
          phone: member.phone,
          role: member.role,
          ...(member.role === 'broker' ? { firm: member.firm } : {}),
        },
      });
      return requireStaffMember(body);
    },

    async update(uid, change) {
      return requireStaffMember(await client.request<unknown>(memberPath(uid), { method: 'PATCH', body: change }));
    },

    async remove(uid) {
      await client.request<unknown>(memberPath(uid), { method: 'DELETE' });
    },

    sendSetPasswordEmail: sendResetEmail,
  };
}

// What a refused call says. al-core's refusals (403, 404, 409, 422) are already written for people,
// so they are shown exactly as sent.
export function staffFailureMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return 'The change could not be saved. Try again.';
  }

  if (error.status === 401) {
    return 'Your session has expired. Sign in again.';
  }

  return error.message;
}
