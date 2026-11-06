import { describe, expect, it } from 'vitest';
import type { BrokerClient } from '../../services/clientsService';
import type { ThreadSnapshot } from '../../services/messagesService';
import { inboxThreads, sortThreads, type InboxThread } from './inboxThreads';

const at = (iso: string) => new Date(iso);

function client(id: string, fullName: string, applicationIds: string[]): BrokerClient {
  return {
    id,
    profile: { uid: id, fullName, email: null, county: null },
    applications: applicationIds.map((applicationId) => ({
      id: applicationId, borrowerId: id, status: 'Applied', loanType: 'mortgage',
      loanAmountEur: null, ltvPct: null, updatedAt: null,
    })),
  };
}

function thread(messages: [string, string][], lastReadAt: Date | null): ThreadSnapshot {
  return {
    messages: messages.map(([senderId, sentAt], index) => ({
      id: `m${index}`, senderId, senderRole: senderId === 'broker-1' ? 'broker' : 'borrower', text: `text ${index}`, sentAt: at(sentAt),
    })),
    lastReadAt,
  };
}

describe('inbox threads', () => {
  it('builds one thread per application with this broker\'s unread count and the last message', () => {
    const threads = new Map([
      ['app-1', thread([['alice', '2026-11-01T10:00:00Z'], ['broker-1', '2026-11-01T11:00:00Z'], ['alice', '2026-11-02T09:00:00Z']], at('2026-11-01T11:00:00Z'))],
    ]);
    const rows = inboxThreads([client('alice', 'Alice Byrne', ['app-1']), client('ben', 'Ben Walsh', ['app-2'])], threads, 'broker-1');

    expect(rows).toEqual([
      { applicationId: 'app-1', clientName: 'Alice Byrne', unread: 1, last: threads.get('app-1')!.messages[2], loaded: true },
      { applicationId: 'app-2', clientName: 'Ben Walsh', unread: 0, last: null, loaded: false },
    ]);
  });

  it('counts every message from someone else as unread before the broker first opens the thread', () => {
    const rows = inboxThreads(
      [client('alice', 'Alice Byrne', ['app-1'])],
      new Map([['app-1', thread([['alice', '2026-11-01T10:00:00Z'], ['uma', '2026-11-01T10:05:00Z'], ['broker-1', '2026-11-01T10:10:00Z']], null)]]),
      'broker-1',
    );
    expect(rows[0].unread).toBe(2);
  });
});

describe('thread order', () => {
  function row(applicationId: string, unread: number, sentAt: string | null, clientName = 'Client'): InboxThread {
    return {
      applicationId, clientName, unread, loaded: true,
      last: sentAt ? { id: 'm', senderId: 'x', senderRole: 'borrower', text: 't', sentAt: at(sentAt) } : null,
    };
  }

  it('puts unread threads first, then the most recent message, then the client name', () => {
    const sorted = sortThreads([
      row('read-new', 0, '2026-11-05T10:00:00Z'),
      row('unread-old', 1, '2026-10-01T10:00:00Z'),
      row('empty', 0, null, 'Aaron'),
      row('unread-new', 3, '2026-11-04T10:00:00Z'),
      row('read-old', 0, '2026-10-20T10:00:00Z'),
    ]);

    expect(sorted.map((thread) => thread.applicationId)).toEqual(['unread-new', 'unread-old', 'read-new', 'read-old', 'empty']);
  });
});
