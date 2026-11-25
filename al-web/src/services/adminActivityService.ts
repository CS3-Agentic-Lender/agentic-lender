import { collection, limit, orderBy, query, type DocumentData } from 'firebase/firestore';
import { readDate, readString } from './clientsService';
import { db } from './firebase';
import { subscribeToCollection, type LiveErrorListener, type LiveListener } from './liveCollection';
import { staffRoleLabels, type StaffRole } from './staffService';

export const ADMIN_ACTION_KINDS = [
  'create_staff',
  'disable_staff',
  'enable_staff',
  'change_role',
  'delete_staff',
  'close_support_request',
  'reopen_support_request',
  'comment_support_request',
] as const;
export type AdminActionKind = (typeof ADMIN_ACTION_KINDS)[number];

// One admin_actions record (al-core/SCHEMA.md). `kind` is null for an action this portal does not know yet.
export interface AdminAction {
  id: string;
  actorUid: string | null;
  kind: AdminActionKind | null;
  action: string;
  targetUid: string | null;
  targetRef: string | null;
  details: Record<string, string>;
  createdAt: Date | null;
}

export const RECENT_ACTIVITY_LIMIT = 20;

export interface AdminActivityService {
  subscribeToRecentActivity(listener: LiveListener<AdminAction>, onError: LiveErrorListener): () => void;
}

function readDetails(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export function toAdminAction(id: string, data: DocumentData): AdminAction {
  const action = readString(data.action) ?? 'unknown';

  return {
    id,
    actorUid: readString(data.actorUid),
    kind: ADMIN_ACTION_KINDS.find((kind) => kind === action) ?? null,
    action,
    targetUid: readString(data.targetUid),
    targetRef: readString(data.targetRef),
    details: readDetails(data.details),
    createdAt: readDate(data.createdAt),
  };
}

function roleWord(role: string | undefined) {
  return role && role in staffRoleLabels ? staffRoleLabels[role as StaffRole].toLowerCase() : 'staff member';
}

function article(word: string) {
  return /^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`;
}

// What each kind of action did, in words, given the name of whatever it acted on.
const actionSentences: Record<AdminActionKind, (target: string, details: Record<string, string>) => string> = {
  create_staff: (target, details) => `added ${target} as ${article(roleWord(details.role))}`,
  disable_staff: (target) => `disabled ${target}`,
  enable_staff: (target) => `enabled ${target}`,
  change_role: (target, details) => `moved ${target} from ${roleWord(details.from)} to ${roleWord(details.to)}`,
  delete_staff: (target, details) => `deleted ${target}${details.role ? `, ${article(roleWord(details.role))}` : ''}`,
  close_support_request: (target) => `resolved support request ${target}`,
  reopen_support_request: (target) => `reopened support request ${target}`,
  comment_support_request: (target) => `added a note to support request ${target}`,
};

// The name each account had in the log itself: the full name a delete kept, else the email a create kept.
// It names a deleted account in every one of its actions, not only the one that recorded it.
export function recordedNames(actions: AdminAction[]) {
  const names = new Map<string, string>();
  for (const { targetUid, details } of actions) {
    if (!targetUid) {
      continue;
    }
    if (details.fullName) {
      names.set(targetUid, details.fullName);
    } else if (details.email && !names.has(targetUid)) {
      names.set(targetUid, details.email);
    }
  }
  return names;
}

// The actor and what they did. Names come from `nameOf` (the staff list, then `recordedNames`); a record
// with no name falls back to the one it kept, then to its uid, so a line never goes blank. A targetRef is a
// document path, so only its last segment (a support request's reference) is shown.
export function describeAdminAction(action: AdminAction, nameOf: (uid: string) => string | null) {
  const actor = (action.actorUid && nameOf(action.actorUid)) ?? 'An admin';
  const target =
    (action.targetUid && nameOf(action.targetUid)) ??
    action.details.fullName ??
    action.details.email ??
    action.targetUid ??
    action.targetRef?.split('/').pop() ??
    'an unknown record';

  return {
    actor,
    summary: action.kind ? actionSentences[action.kind](target, action.details) : `did "${action.action}" on ${target}`,
  };
}

export const firestoreAdminActivityService: AdminActivityService = {
  subscribeToRecentActivity(listener, onError) {
    return subscribeToCollection(
      query(collection(db, 'admin_actions'), orderBy('createdAt', 'desc'), limit(RECENT_ACTIVITY_LIMIT)),
      toAdminAction,
      listener,
      onError,
    );
  },
};
