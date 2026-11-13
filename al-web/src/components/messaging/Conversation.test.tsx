import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagesServiceContext } from '../../context/MessagesContext';
import { ApiError } from '../../services/apiClient';
import type { MessagesService, ThreadError, ThreadSnapshot } from '../../services/messagesService';
import { Conversation } from './Conversation';

class FakeMessages implements MessagesService {
  listener: ((snapshot: ThreadSnapshot) => void) | null = null;
  onError: ((error: ThreadError) => void) | null = null;
  stopped = 0;
  send = vi.fn<MessagesService['send']>().mockResolvedValue(undefined);
  markRead = vi.fn<MessagesService['markRead']>().mockResolvedValue(undefined);

  subscribeToThread: MessagesService['subscribeToThread'] = (_id, _uid, listener, onError) => {
    this.listener = listener;
    this.onError = onError;
    return () => {
      this.stopped += 1;
    };
  };

  push(snapshot: ThreadSnapshot) {
    act(() => this.listener?.(snapshot));
  }
}

const message = (id: string, senderId: string, senderRole: 'borrower' | 'broker' | 'underwriter', iso: string, text = id) => ({
  id, senderId, senderRole, text, sentAt: new Date(iso),
});

function renderConversation(service = new FakeMessages(), uid = 'broker-1') {
  const view = render(
    <MessagesServiceContext.Provider value={service}>
      <Conversation applicationId="app-applied" title="Alice Byrne" uid={uid} />
    </MessagesServiceContext.Provider>,
  );
  return { ...view, service };
}

afterEach(cleanup);

describe('conversation', () => {
  it('shows each sender, with the underwriter as the bank lending officer and the reader as You', () => {
    const { service } = renderConversation();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the messages…');

    service.push({
      messages: [
        message('m1', 'alice', 'borrower', '2026-11-01T10:00:00Z', 'When will I hear back?'),
        message('m2', 'uma', 'underwriter', '2026-11-01T11:00:00Z', 'We are reviewing it.'),
        message('m3', 'broker-1', 'broker', '2026-11-01T12:00:00Z', 'I will follow up.'),
      ],
      lastReadAt: new Date('2026-11-01T12:00:00Z'),
    });

    const items = within(screen.getByRole('list', { name: 'Messages' })).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('span')?.textContent)).toEqual(['Borrower', 'Bank lending officer', 'You']);
    expect(items[1]).toHaveTextContent('We are reviewing it.');
  });

  it('moves only this reader\'s read position, once, after the thread loads with something unread', () => {
    const { service } = renderConversation();
    expect(service.markRead).not.toHaveBeenCalled();

    service.push({ messages: [message('m1', 'alice', 'borrower', '2026-11-01T10:00:00Z')], lastReadAt: null });
    expect(service.markRead).toHaveBeenCalledExactlyOnceWith('app-applied');
  });

  it('does not mark anything read when nothing is unread', () => {
    const { service } = renderConversation();
    service.push({ messages: [message('m1', 'broker-1', 'broker', '2026-11-01T10:00:00Z')], lastReadAt: null });
    expect(service.markRead).not.toHaveBeenCalled();
  });

  it('keeps Send disabled for an empty or blank reply', () => {
    const { service } = renderConversation();
    service.push({ messages: [], lastReadAt: null });
    expect(screen.getByText('No messages yet.')).toBeInTheDocument();

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: '   ' } });
    expect(send).toBeDisabled();
  });

  it('sends the trimmed reply once and clears it only after the server saved it', async () => {
    const { service } = renderConversation();
    service.push({ messages: [], lastReadAt: null });
    let resolve!: () => void;
    service.send.mockImplementation(() => new Promise((done) => { resolve = done; }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: '  Thanks, will do.  ' } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    });

    expect(service.send).toHaveBeenCalledExactlyOnceWith('app-applied', 'Thanks, will do.');
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('  Thanks, will do.  ');
    await act(async () => resolve());
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  });

  it.each([
    [new ApiError('http', 'Draft', 409), 'This thread opens once the application is submitted.'],
    [new ApiError('http', 'Not found', 404), 'You are not allowed to message on this application.'],
    [new ApiError('network', 'offline'), 'Could not reach the server. Check your connection and try again.'],
  ])('keeps the reply and shows why a send failed (%s)', async (error, text) => {
    const { service } = renderConversation();
    service.push({ messages: [], lastReadAt: null });
    service.send.mockRejectedValue(error);

    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'Hello' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));

    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Hello');
  });

  it('says when the thread cannot be read and stops listening when closed', () => {
    const { service, unmount } = renderConversation();
    act(() => service.onError?.('permission-denied'));
    expect(screen.getByRole('alert')).toHaveTextContent('You are not allowed to read this thread.');

    unmount();
    expect(service.stopped).toBe(1);
  });
});
