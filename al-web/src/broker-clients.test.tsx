import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider } from './context/AuthContext';
import { ClientsServiceContext } from './context/BrokerClientsContext';
import { AppRoutes } from './routes';
import type { AuthService, AuthStateListener, AuthUser, TrustedRole } from './services/authService';
import {
  buildBrokerClients,
  type BrokerApplication,
  type BrokerClientsSnapshot,
  type ClientProfile,
  type ClientsError,
  type ClientsErrorListener,
  type ClientsListener,
  type ClientsService,
} from './services/clientsService';

function authUser(uid: string): AuthUser {
  return {
    uid,
    email: `${uid}@example.test`,
    getIdToken: async () => 'id-token',
    getIdTokenResult: async () => ({ claims: {} }) as never,
  };
}

class FakeAuthService implements AuthService {
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

interface Subscription {
  brokerUid: string;
  listener: ClientsListener;
  onError: ClientsErrorListener;
  active: boolean;
}

// Answers each subscription with that broker's own files only, the way the Firestore rules do.
class FakeClientsService implements ClientsService {
  readonly subscriptions: Subscription[] = [];

  constructor(private readonly filesByBroker: Record<string, BrokerClientsSnapshot> = {}) {}

  subscribeToBrokerClients(brokerUid: string, listener: ClientsListener, onError: ClientsErrorListener) {
    const subscription: Subscription = { brokerUid, listener, onError, active: true };
    this.subscriptions.push(subscription);

    const files = this.filesByBroker[brokerUid];
    if (files) {
      listener(files);
    }

    return () => {
      subscription.active = false;
    };
  }

  push(brokerUid: string, snapshot: BrokerClientsSnapshot) {
    this.active(brokerUid).forEach(({ listener }) => listener(snapshot));
  }

  fail(brokerUid: string, error: ClientsError) {
    this.active(brokerUid).forEach(({ onError }) => onError(error));
  }

  private active(brokerUid: string) {
    return this.subscriptions.filter((subscription) => subscription.active && subscription.brokerUid === brokerUid);
  }
}

function profile(uid: string, fullName: string): ClientProfile {
  return { uid, fullName, email: `${uid}@example.test`, county: 'Cork' };
}

function application(id: string, borrowerId: string, status: string): BrokerApplication {
  return {
    id,
    borrowerId,
    status,
    loanType: 'mortgage',
    loanAmountEur: 230000,
    ltvPct: 82.5,
    updatedAt: new Date('2026-10-05T10:00:00Z'),
  };
}

function files(profiles: ClientProfile[], applications: BrokerApplication[], profilesAvailable = true) {
  return { clients: buildBrokerClients(profiles, applications), profilesAvailable };
}

const alice = profile('borrower-1', 'Alice Byrne');
const ben = profile('borrower-2', 'Ben Walsh');

const seededFiles = {
  'broker-1': files([alice], [application('LN-1001', 'borrower-1', 'Applied')]),
  'broker-2': files([ben], [application('LN-2001', 'borrower-2', 'Funded')]),
};

function renderAs(uid: string, role: TrustedRole, pathname: string, clients: FakeClientsService) {
  return render(
    <AuthProvider service={new FakeAuthService(authUser(uid), role)}>
      <ClientsServiceContext.Provider value={clients}>
        <MemoryRouter initialEntries={[pathname]}>
          <AppRoutes />
        </MemoryRouter>
      </ClientsServiceContext.Provider>
    </AuthProvider>,
  );
}

afterEach(cleanup);

describe('broker client list', () => {
  it('shows the first broker only their own client', async () => {
    renderAs('broker-1', 'broker', '/broker/clients', new FakeClientsService(seededFiles));

    expect(await screen.findByRole('link', { name: 'Alice Byrne' })).toBeInTheDocument();
    expect(screen.getByText('LN-1001')).toBeInTheDocument();
    expect(screen.queryByText('Ben Walsh')).not.toBeInTheDocument();
    expect(screen.queryByText('LN-2001')).not.toBeInTheDocument();
  });

  it('shows the second broker a different list', async () => {
    renderAs('broker-2', 'broker', '/broker/clients', new FakeClientsService(seededFiles));

    expect(await screen.findByRole('link', { name: 'Ben Walsh' })).toBeInTheDocument();
    expect(screen.getByText('LN-2001')).toBeInTheDocument();
    expect(screen.queryByText('Alice Byrne')).not.toBeInTheDocument();
  });

  it('subscribes with the signed-in broker and nobody else', async () => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('broker-1', 'broker', '/broker/clients', clients);

    await screen.findByRole('link', { name: 'Alice Byrne' });
    expect(clients.subscriptions.map(({ brokerUid }) => brokerUid)).toEqual(['broker-1']);
  });

  it('adds a client without a reload when a borrower chooses this broker', async () => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne' });

    act(() => {
      clients.push('broker-1', files([alice, ben], [application('LN-1001', 'borrower-1', 'Applied')]));
    });

    const row = (await screen.findByRole('link', { name: 'Ben Walsh' })).closest('tr');
    expect(within(row!).getByText('No application yet')).toBeInTheDocument();
  });

  it('removes a client who moves to another broker', async () => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne' });

    act(() => {
      clients.push('broker-1', files([], []));
    });

    expect(await screen.findByRole('heading', { name: 'No clients yet' })).toBeInTheDocument();
    expect(screen.queryByText('Alice Byrne')).not.toBeInTheDocument();
  });

  it('stops listening when the broker signs out', async () => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Portal access' })).toBeInTheDocument();
    expect(clients.subscriptions.every(({ active }) => !active)).toBe(true);
    expect(screen.queryByText('Alice Byrne')).not.toBeInTheDocument();
  });

  it('stops listening when the page is left', async () => {
    const clients = new FakeClientsService(seededFiles);
    const view = renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne' });

    view.unmount();

    expect(clients.subscriptions.every(({ active }) => !active)).toBe(true);
  });

  it('shows a loading state before the first answer and no table', async () => {
    renderAs('broker-1', 'broker', '/broker/clients', new FakeClientsService());

    expect(await screen.findByRole('heading', { name: 'Loading your clients' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says so when the broker has no clients', async () => {
    renderAs('broker-1', 'broker', '/broker/clients', new FakeClientsService({ 'broker-1': files([], []) }));

    expect(await screen.findByRole('heading', { name: 'No clients yet' })).toBeInTheDocument();
  });

  it.each([
    ['permission-denied', 'Client files are not available'],
    ['unavailable', 'Client files could not be loaded'],
  ] as const)('shows a clear state for a %s failure', async (error, heading) => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne' });

    act(() => {
      clients.fail('broker-1', error);
    });

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByText('Alice Byrne')).not.toBeInTheDocument();
  });

  it('lists clients by ID and says why when profiles cannot be read', async () => {
    const clients = new FakeClientsService({
      'broker-1': files([], [application('LN-1001', 'borrower-1', 'Applied')], false),
    });
    renderAs('broker-1', 'broker', '/broker/clients', clients);

    expect(await screen.findByRole('link', { name: 'Name unavailable' })).toBeInTheDocument();
    expect(screen.getByText('borrower-1')).toBeInTheDocument();
    expect(screen.getByText(/Client names are not available yet/)).toBeInTheDocument();
  });

  it('narrows the table with the search box and the status filter and keeps the count in step', async () => {
    const clients = new FakeClientsService({
      'broker-1': files(
        [alice, ben],
        [application('LN-1001', 'borrower-1', 'Applied'), application('LN-1002', 'borrower-2', 'Funded')],
      ),
    });
    renderAs('broker-1', 'broker', '/broker/clients', clients);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Alice Byrne' });
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'Funded');
    expect(screen.queryByRole('link', { name: 'Alice Byrne' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search'), 'alice');
    expect(screen.getByText('No clients match these filters.')).toBeInTheDocument();
    expect(screen.getByText('Showing 0 of 2')).toBeInTheDocument();
  });

  it('refuses an underwriter', async () => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('underwriter-1', 'underwriter', '/broker/clients', clients);

    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
    expect(clients.subscriptions).toHaveLength(0);
  });
});

describe('broker client file', () => {
  it('opens one of the broker’s own clients with their applications', async () => {
    renderAs('broker-1', 'broker', '/broker/clients/borrower-1', new FakeClientsService(seededFiles));

    expect(await screen.findByRole('heading', { name: 'Alice Byrne' })).toBeInTheDocument();
    expect(screen.getByText('LN-1001')).toBeInTheDocument();
    expect(screen.getByText('Applied')).toBeInTheDocument();
  });

  it('shows not found for another broker’s client opened by URL', async () => {
    renderAs('broker-1', 'broker', '/broker/clients/borrower-2', new FakeClientsService(seededFiles));

    expect(await screen.findByRole('heading', { name: 'Client not found' })).toBeInTheDocument();
    expect(screen.queryByText('Ben Walsh')).not.toBeInTheDocument();
    expect(screen.queryByText('LN-2001')).not.toBeInTheDocument();
  });

  it('gives the same answer for a client that does not exist', async () => {
    renderAs('broker-1', 'broker', '/broker/clients/nobody', new FakeClientsService(seededFiles));

    expect(await screen.findByRole('heading', { name: 'Client not found' })).toBeInTheDocument();
  });

  it('follows the link from the list to the client file', async () => {
    renderAs('broker-1', 'broker', '/broker/clients', new FakeClientsService(seededFiles));

    await userEvent.setup().click(await screen.findByRole('link', { name: 'Alice Byrne' }));

    expect(await screen.findByRole('heading', { name: 'Alice Byrne' })).toBeInTheDocument();
    expect(screen.getByText('Client ID')).toBeInTheDocument();
  });
});
