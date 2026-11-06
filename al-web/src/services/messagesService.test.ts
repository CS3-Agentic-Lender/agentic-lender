import { Timestamp } from 'firebase/firestore';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './apiClient';
import { createMessagesService, senderLabels, toThreadMessage, unreadCount } from './messagesService';

describe('thread messages', () => {
  it('reads a stored message with its trusted sender role', () => {
    const sentAt = new Date('2026-11-01T10:00:00Z');
    expect(toThreadMessage('m1', { senderId: 'uma', senderRole: 'underwriter', text: 'Hello', sentAt: Timestamp.fromDate(sentAt) }))
      .toEqual({ id: 'm1', senderId: 'uma', senderRole: 'underwriter', text: 'Hello', sentAt });
  });

  it('keeps a message with an unknown role but drops one with no text', () => {
    expect(toThreadMessage('m1', { senderId: 'x', senderRole: 'admin', text: 'Hi' })?.senderRole).toBeNull();
    expect(toThreadMessage('m2', { senderId: 'x', senderRole: 'broker' })).toBeNull();
  });

  it('labels an underwriter as the bank lending officer', () => {
    expect(senderLabels).toEqual({ borrower: 'Borrower', broker: 'Broker', underwriter: 'Bank lending officer' });
  });

  it('counts only messages from someone else after the last read time', () => {
    const message = (senderId: string, iso: string) => ({ id: iso, senderId, senderRole: null, text: 't', sentAt: new Date(iso) });
    const messages = [message('alice', '2026-11-01T10:00:00Z'), message('me', '2026-11-01T11:00:00Z'), message('alice', '2026-11-01T12:00:00Z')];

    expect(unreadCount({ messages, lastReadAt: new Date('2026-11-01T10:00:00Z') }, 'me')).toBe(1);
    expect(unreadCount({ messages, lastReadAt: new Date('2026-11-01T12:00:00Z') }, 'me')).toBe(0);
    expect(unreadCount({ messages, lastReadAt: null }, 'me')).toBe(2);
  });
});

describe('message writes', () => {
  it('sends and marks read through al-core, never Firestore', async () => {
    const request = vi.fn<ApiClient['request']>().mockResolvedValue({});
    const service = createMessagesService({ request: request as ApiClient['request'] });

    await service.send('app a', 'Any update?');
    await service.markRead('app a');

    expect(request.mock.calls).toEqual([
      ['/core/applications/app%20a/messages', { method: 'POST', body: { text: 'Any update?' } }],
      ['/core/applications/app%20a/messages/read', { method: 'POST' }],
    ]);
  });
});
