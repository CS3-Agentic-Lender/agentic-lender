import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './context/AuthContext';
import { ClientsServiceContext } from './context/BrokerClientsContext';
import { MessagesServiceContext } from './context/MessagesContext';
import { AppRoutes } from './routes';
import type { AuthService, AuthStateListener, AuthUser } from './services/authService';
import { buildBrokerClients, type ClientsService } from './services/clientsService';
import type { MessagesService, ThreadSnapshot } from './services/messagesService';

const broker: AuthUser = {
  uid: 'broker-1',
  email: 'broker-1@example.test',
  getIdToken: async () => 'id-token',
  getIdTokenResult: async () => ({ claims: {} }) as never,
};

class FakeAuthService implements AuthService {
  subscribe(listener: AuthStateListener) {
    listener(broker);
    return () => {};
  }
  async signIn() {}
  async signOut() {}
  async resolveTrustedRole() {
    return { role: 'broker' as const, denialReason: null };
  }
  async getCurrentIdToken() {
    return 'id-token';
  }
}

const clients: ClientsService = {
  subscribeToBrokerClients: (_uid, listener) => {
    listener({
      clients: buildBrokerClients(
        [
          { uid: 'alice', fullName: 'Alice Byrne', email: null, county: null },
          { uid: 'ben', fullName: 'Ben Walsh', email: null, county: null },
        ],
        [
          { id: 'LN-1001', borrowerId: 'alice', status: 'Applied', loanType: 'mortgage', loanAmountEur: null, ltvPct: null, updatedAt: null },
          { id: 'LN-2001', borrowerId: 'ben', status: 'Funded', loanType: 'mortgage', loanAmountEur: null, ltvPct: null, updatedAt: null },
        ],
      ),
      profilesState: 'available',
    });
    return () => {};
  },
};

class FakeMessages implements MessagesService {
  listeners = new Map<string, ((snapshot: ThreadSnapshot) => void)[]>();
  send = vi.fn<MessagesService['send']>().mockResolvedValue(undefined);
  markRead = vi.fn<MessagesService['markRead']>().mockResolvedValue(undefined);

  subscribeToThread: MessagesService['subscribeToThread'] = (id, _uid, listener) => {
    this.listeners.set(id, [...(this.listeners.get(id) ?? []), listener]);
    return () => {
      this.listeners.set(id, (this.listeners.get(id) ?? []).filter((entry) => entry !== listener));
    };
  };

  push(id: string, snapshot: ThreadSnapshot) {
    act(() => this.listeners.get(id)?.forEach((listener) => listener(snapshot)));
  }
}

const message = (id: string, senderId: string, iso: string, text: string) => ({
  id, senderId, senderRole: senderId === 'broker-1' ? ('broker' as const) : ('borrower' as const), text, sentAt: new Date(iso),
});

function renderInbox(messages: FakeMessages) {
  return render(
    <AuthProvider service={new FakeAuthService()}>
      <ClientsServiceContext.Provider value={clients}>
        <MessagesServiceContext.Provider value={messages}>
          <MemoryRouter initialEntries={['/broker/messages']}>
            <AppRoutes />
          </MemoryRouter>
        </MessagesServiceContext.Provider>
      </ClientsServiceContext.Provider>
    </AuthProvider>,
  );
}

afterEach(cleanup);

describe('broker messages inbox', () => {
  it('lists one thread per client application, unread first, and reorders live', async () => {
    const messages = new FakeMessages();
    renderInbox(messages);
    await screen.findByRole('list', { name: 'Threads' });

    // Ben's thread has the newer message, so it comes first while nothing is unread.
    messages.push('LN-1001', { messages: [message('a1', 'alice', '2026-11-01T10:00:00Z', 'Hi')], lastReadAt: new Date('2026-11-01T10:00:00Z') });
    messages.push('LN-2001', { messages: [message('b1', 'ben', '2026-11-02T10:00:00Z', 'Thanks')], lastReadAt: new Date('2026-11-02T10:00:00Z') });
    const names = () => within(screen.getByRole('list', { name: 'Threads' })).getAllByRole('button').map((button) => button.textContent);
    expect(names()[0]).toContain('Ben Walsh');

    // A new message from Alice makes her thread unread, so it moves to the top.
    messages.push('LN-1001', {
      messages: [message('a1', 'alice', '2026-11-01T10:00:00Z', 'Hi'), message('a2', 'alice', '2026-11-03T09:00:00Z', 'Any news?')],
      lastReadAt: new Date('2026-11-01T10:00:00Z'),
    });
    expect(names()[0]).toContain('Alice Byrne');
    expect(names()[0]).toContain('1 unread');
    expect(names()[0]).toContain('Any news?');
  });

  it('opens a thread beside the list, marks it read for this broker and replies through the service', async () => {
    const messages = new FakeMessages();
    renderInbox(messages);
    await screen.findByRole('list', { name: 'Threads' });
    messages.push('LN-1001', { messages: [message('a1', 'alice', '2026-11-03T09:00:00Z', 'Any news?')], lastReadAt: null });

    fireEvent.click(screen.getByRole('button', { name: /Alice Byrne/ }));
    expect(screen.getByRole('region', { name: 'Messages: Alice Byrne' })).toBeInTheDocument();
    messages.push('LN-1001', { messages: [message('a1', 'alice', '2026-11-03T09:00:00Z', 'Any news?')], lastReadAt: null });
    expect(messages.markRead).toHaveBeenCalledWith('LN-1001');

    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'Checking now.' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(messages.send).toHaveBeenCalledExactlyOnceWith('LN-1001', 'Checking now.');
  });

  it('links Messages from the broker header', async () => {
    renderInbox(new FakeMessages());
    expect(await screen.findByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/broker/messages');
  });
});
