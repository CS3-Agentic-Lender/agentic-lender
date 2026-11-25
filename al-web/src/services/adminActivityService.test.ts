import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { describeAdminAction, recordedNames, toAdminAction } from './adminActivityService';

const names = new Map([
  ['admin1', 'Ada Admin'],
  ['broker1', 'Bob Murphy'],
]);
const nameOf = (uid: string) => names.get(uid) ?? null;

describe('admin activity', () => {
  it('reads an admin_actions record', () => {
    const createdAt = new Date('2026-11-24T12:00:00Z');
    expect(
      toAdminAction('a1', {
        actorUid: 'admin1',
        action: 'change_role',
        targetUid: 'broker1',
        details: { from: 'broker', to: 'underwriter', ignored: 3 },
        createdAt: Timestamp.fromDate(createdAt),
      }),
    ).toEqual({
      id: 'a1',
      actorUid: 'admin1',
      kind: 'change_role',
      action: 'change_role',
      targetUid: 'broker1',
      targetRef: null,
      details: { from: 'broker', to: 'underwriter' },
      createdAt,
    });
  });

  it.each([
    [{ action: 'enable_staff', targetUid: 'broker1' }, 'enabled Bob Murphy'],
    [{ action: 'create_staff', targetUid: 'new-1', details: { role: 'underwriter', email: 'una@test.com' } }, 'added una@test.com as an underwriter'],
    [{ action: 'delete_staff', targetUid: 'gone', details: { role: 'broker', fullName: 'Eve Long' } }, 'deleted Eve Long, a broker'],
    [{ action: 'disable_staff', targetUid: 'unknown-uid' }, 'disabled unknown-uid'],
    [{ action: 'comment_support_request', targetRef: 'support_requests/SR-1', details: { noteId: 'n1' } }, 'added a note to support request SR-1'],
    [{ action: 'reopen_support_request', targetRef: 'support_requests/SR-1' }, 'reopened support request SR-1'],
    [{ action: 'reset_mfa', targetUid: 'broker1' }, 'did "reset_mfa" on Bob Murphy'],
  ])('describes %o', (record, summary) => {
    const action = toAdminAction('a1', { actorUid: 'admin1', ...record });
    expect(describeAdminAction(action, nameOf)).toEqual({ actor: 'Ada Admin', summary });
  });

  it('names an actor it cannot find as an admin', () => {
    const action = toAdminAction('a1', { actorUid: 'old-admin', action: 'close_support_request', targetRef: 'SR-1' });
    expect(describeAdminAction(action, nameOf)).toEqual({ actor: 'An admin', summary: 'resolved support request SR-1' });
  });

  it('shows a support request by its reference, not its document path', () => {
    const action = toAdminAction('a1', {
      actorUid: 'admin1',
      action: 'close_support_request',
      targetRef: 'support_requests/SR-4JWHGMPM',
    });
    expect(describeAdminAction(action, nameOf).summary).toBe('resolved support request SR-4JWHGMPM');
  });

  it('names a deleted account in its earlier actions from what the log recorded', () => {
    const actions = [
      toAdminAction('a3', { action: 'delete_staff', targetUid: 'gone', details: { role: 'underwriter', fullName: 'Una Reilly' } }),
      toAdminAction('a2', { action: 'disable_staff', targetUid: 'gone' }),
      toAdminAction('a1', { action: 'create_staff', targetUid: 'gone', details: { role: 'underwriter', email: 'una@test.com' } }),
      toAdminAction('a0', { action: 'create_staff', targetUid: 'other', details: { role: 'broker', email: 'only@test.com' } }),
    ];
    const recorded = recordedNames(actions);
    const lookup = (uid: string) => recorded.get(uid) ?? null;
    expect(actions.map((action) => describeAdminAction(action, lookup).summary)).toEqual([
      'deleted Una Reilly, an underwriter',
      'disabled Una Reilly',
      'added Una Reilly as an underwriter',
      'added only@test.com as a broker',
    ]);
  });
});
