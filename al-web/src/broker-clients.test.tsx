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

function files(profiles: ClientProfile[], applications: BrokerApplication[], profilesState: BrokerClientsSnapshot['profilesState'] = 'available') {
  return { clients: buildBrokerClients(profiles, applications), profilesState };
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

    expect(await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' })).toBeInTheDocument();
    expect(screen.getByText('LN-1001')).toBeInTheDocument();
    expect(screen.queryByText('Ben Walsh')).not.toBeInTheDocument();
    expect(screen.queryByText('LN-2001')).not.toBeInTheDocument();
  });

  it('shows the second broker a different list', async () => {
    renderAs('broker-2', 'broker', '/broker/clients', new FakeClientsService(seededFiles));

    expect(await screen.findByRole('link', { name: 'Ben Walsh, client borrower-2' })).toBeInTheDocument();
    expect(screen.getByText('LN-2001')).toBeInTheDocument();
    expect(screen.queryByText('Alice Byrne')).not.toBeInTheDocument();
  });

  it('subscribes with the signed-in broker and nobody else', async () => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('broker-1', 'broker', '/broker/clients', clients);

    await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' });
    expect(clients.subscriptions.map(({ brokerUid }) => brokerUid)).toEqual(['broker-1']);
  });

  it('adds a client without a reload when a borrower chooses this broker', async () => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' });

    act(() => {
      clients.push('broker-1', files([alice, ben], [application('LN-1001', 'borrower-1', 'Applied')]));
    });

    const row = (await screen.findByRole('link', { name: 'Ben Walsh, client borrower-2' })).closest('tr');
    expect(within(row!).getByText('No submitted application yet')).toBeInTheDocument();
  });

  it('removes a client who moves to another broker', async () => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' });

    act(() => {
      clients.push('broker-1', files([], []));
    });

    expect(await screen.findByRole('heading', { name: 'No clients yet' })).toBeInTheDocument();
    expect(screen.queryByText('Alice Byrne')).not.toBeInTheDocument();
  });

  it('stops listening when the broker signs out', async () => {
    const clients = new FakeClientsService(seededFiles);
    renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Portal access' })).toBeInTheDocument();
    expect(clients.subscriptions.every(({ active }) => !active)).toBe(true);
    expect(screen.queryByText('Alice Byrne')).not.toBeInTheDocument();
  });

  it('stops listening when the page is left', async () => {
    const clients = new FakeClientsService(seededFiles);
    const view = renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' });

    view.unmount();

    expect(clients.subscriptions.every(({ active }) => !active)).toBe(true);
  });

  it('shows a loading state before the first answer and no table', async () => {
    renderAs('broker-1', 'broker', '/broker/clients', new FakeClientsService());

    expect(await screen.findByRole('heading', { name: 'Loading your clients' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // The applications query excludes Drafts, so such a borrower arrives from profiles only.
  it('lists a borrower whose only application is a Draft with no application', async () => {
    renderAs('broker-1', 'broker', '/broker/clients', new FakeClientsService({ 'broker-1': files([ben], []) }));

    const row = (await screen.findByRole('link', { name: 'Ben Walsh, client borrower-2' })).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('No submitted application yet')).toBeInTheDocument();
    expect(within(row!).queryByText('Draft')).not.toBeInTheDocument();
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
    await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' });

    act(() => {
      clients.fail('broker-1', error);
    });

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByText('Alice Byrne')).not.toBeInTheDocument();
  });

  it('lists clients by ID and says why when profiles cannot be read', async () => {
    const clients = new FakeClientsService({
      'broker-1': files([], [application('LN-1001', 'borrower-1', 'Applied')], 'unavailable'),
    });
    renderAs('broker-1', 'broker', '/broker/clients', clients);

    expect(await screen.findByRole('link', { name: 'Name unavailable, client borrower-1' })).toBeInTheDocument();
    expect(screen.getByText('borrower-1')).toBeInTheDocument();
    expect(screen.getByText(/Client names are not available yet/)).toBeInTheDocument();
  });

  it('shows the loading state, not an empty list, while a client with no application waits for profiles', async () => {
    renderAs('broker-1', 'broker', '/broker/clients', new FakeClientsService({ 'broker-1': files([], [], 'pending') }));

    expect(await screen.findByRole('heading', { name: 'Loading your clients' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No clients yet' })).not.toBeInTheDocument();
  });

  it('says names could not be loaded, not that there are no clients, when profiles are unavailable', async () => {
    renderAs(
      'broker-1',
      'broker',
      '/broker/clients',
      new FakeClientsService({ 'broker-1': files([], [], 'unavailable') }),
    );

    expect(await screen.findByRole('heading', { name: 'Clients could not be fully loaded' })).toBeInTheDocument();
    expect(screen.getByText(/Client names are not available yet/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No clients yet' })).not.toBeInTheDocument();
  });

  it('shows no clients yet only once profiles have answered with nothing', async () => {
    const clients = new FakeClientsService({ 'broker-1': files([], [], 'pending') });
    await act(async () => {
      renderAs('broker-1', 'broker', '/broker/clients', clients);
    });

    expect(clients.subscriptions.map(({ brokerUid, active }) => ({ brokerUid, active }))).toEqual([
      { brokerUid: 'broker-1', active: true },
    ]);
    expect(screen.getByRole('heading', { name: 'Loading your clients' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No clients yet' })).not.toBeInTheDocument();

    await act(async () => {
      clients.push('broker-1', files([], [], 'available'));
    });

    expect(screen.getByRole('heading', { name: 'No clients yet' })).toBeInTheDocument();
  });

  it('tells apart several clients whose names are unavailable by their client ID', async () => {
    const clients = new FakeClientsService({
      'broker-1': files(
        [],
        [application('LN-1001', 'borrower-1', 'Applied'), application('LN-1002', 'borrower-2', 'Applied')],
        'unavailable',
      ),
    });
    renderAs('broker-1', 'broker', '/broker/clients', clients);

    const first = await screen.findByRole('link', { name: 'Name unavailable, client borrower-1' });
    const second = screen.getByRole('link', { name: 'Name unavailable, client borrower-2' });
    expect(first).toHaveTextContent('Name unavailable');
    expect(first).toHaveAttribute('href', '/broker/clients/borrower-1');
    expect(second).toHaveAttribute('href', '/broker/clients/borrower-2');
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
    await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' });
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'Funded');
    expect(screen.queryByRole('link', { name: 'Alice Byrne, client borrower-1' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search'), 'alice');
    expect(screen.getByText('No clients match these filters.')).toBeInTheDocument();
    expect(screen.getByText('Showing 0 of 2')).toBeInTheDocument();
  });

  it('does not offer Draft in the status filter, because brokers never see Drafts', async () => {
    const clients = new FakeClientsService({
      'broker-1': files([alice], [application('LN-1001', 'borrower-1', 'Applied')]),
    });
    renderAs('broker-1', 'broker', '/broker/clients', clients);
    await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' });

    const filter = screen.getByLabelText('Status');
    expect(within(filter).queryByRole('option', { name: 'Draft' })).not.toBeInTheDocument();
    expect(within(filter).getByRole('option', { name: 'Applied' })).toBeInTheDocument();
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

  it('opens a borrower whose only application is a Draft with no applications listed', async () => {
    renderAs('broker-1', 'broker', '/broker/clients/borrower-2', new FakeClientsService({ 'broker-1': files([ben], []) }));

    expect(await screen.findByRole('heading', { name: 'Ben Walsh' })).toBeInTheDocument();
    expect(screen.getByText('This client has no submitted application yet.')).toBeInTheDocument();
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

  it('keeps a top-level heading on the client file while it loads', async () => {
    renderAs('broker-1', 'broker', '/broker/clients/borrower-1', new FakeClientsService());

    expect(await screen.findByRole('heading', { level: 1, name: 'Loading your clients' })).toBeInTheDocument();
  });

  it('shows loading, not not found, for a client known only from profiles while they are pending', async () => {
    const clients = new FakeClientsService({ 'broker-1': files([], [], 'pending') });
    renderAs('broker-1', 'broker', '/broker/clients/borrower-1', clients);

    expect(await screen.findByRole('heading', { level: 1, name: 'Loading your clients' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Client not found' })).not.toBeInTheDocument();

    act(() => {
      clients.push('broker-1', files([alice], [], 'available'));
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' })).toBeInTheDocument();
    expect(screen.getByText('This client has no submitted application yet.')).toBeInTheDocument();
  });

  it('shows not found once profiles have answered and the client is not in them', async () => {
    const clients = new FakeClientsService({ 'broker-1': files([], [], 'pending') });
    renderAs('broker-1', 'broker', '/broker/clients/borrower-1', clients);
    await screen.findByRole('heading', { level: 1, name: 'Loading your clients' });

    act(() => {
      clients.push('broker-1', files([], [], 'available'));
    });

    expect(await screen.findByRole('heading', { name: 'Client not found' })).toBeInTheDocument();
  });

  it('says the client could not be checked, not that it is missing, when profiles are unavailable', async () => {
    renderAs(
      'broker-1',
      'broker',
      '/broker/clients/borrower-1',
      new FakeClientsService({ 'broker-1': files([], [], 'unavailable') }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Could not check this client' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Client not found' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to my clients' })).toBeInTheDocument();
  });

  it('still opens a client known from its applications when profiles are unavailable', async () => {
    renderAs(
      'broker-1',
      'broker',
      '/broker/clients/borrower-1',
      new FakeClientsService({ 'broker-1': files([], [application('LN-1001', 'borrower-1', 'Applied')], 'unavailable') }),
    );

    expect(await screen.findByText('Name unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Could not check this client' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Client not found' })).not.toBeInTheDocument();
  });

  it('follows the link from the list to the client file', async () => {
    renderAs('broker-1', 'broker', '/broker/clients', new FakeClientsService(seededFiles));

    await userEvent.setup().click(await screen.findByRole('link', { name: 'Alice Byrne, client borrower-1' }));

    expect(await screen.findByRole('heading', { name: 'Alice Byrne' })).toBeInTheDocument();
    expect(screen.getByText('Client ID')).toBeInTheDocument();
  });
});

describe.each([
  ['/broker/clients', 'link'],
  ['/broker/clients/borrower-1', 'heading'],
] as const)('pending profiles on %s', (pathname, nameRole) => {
  function pendingFiles() {
    return files([], [application('LN-1001', 'borrower-1', 'Applied')], 'pending');
  }

  // A list link also carries the client ID in its accessible name; the file heading does not.
  function displayName(name: string) {
    return nameRole === 'link' ? `${name}, client borrower-1` : name;
  }

  it('shows applications and client IDs while profiles are pending without the unavailable notice', async () => {
    renderAs('broker-1', 'broker', pathname, new FakeClientsService({ 'broker-1': pendingFiles() }));

    expect(await screen.findByRole(nameRole, { name: displayName('Loading name') })).toBeInTheDocument();
    expect(screen.getByText('borrower-1')).toBeInTheDocument();
    expect(screen.getByText('LN-1001')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Loading your clients' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Client names are not available yet/)).not.toBeInTheDocument();
  });

  it('shows names arriving later without a reload', async () => {
    const clients = new FakeClientsService({ 'broker-1': pendingFiles() });
    renderAs('broker-1', 'broker', pathname, clients);
    await screen.findByRole(nameRole, { name: displayName('Loading name') });

    act(() => {
      clients.push('broker-1', files([alice], [application('LN-1001', 'borrower-1', 'Applied')]));
    });

    expect(await screen.findByRole(nameRole, { name: displayName('Alice Byrne') })).toBeInTheDocument();
    expect(screen.queryByText('Loading name')).not.toBeInTheDocument();
    expect(screen.getByText('LN-1001')).toBeInTheDocument();
    expect(screen.queryByText(/Client names are not available yet/)).not.toBeInTheDocument();
    expect(clients.subscriptions).toHaveLength(1);
  });

  it('shows the notice when profiles are refused later and keeps applications visible', async () => {
    const clients = new FakeClientsService({ 'broker-1': pendingFiles() });
    renderAs('broker-1', 'broker', pathname, clients);
    await screen.findByRole(nameRole, { name: displayName('Loading name') });

    act(() => {
      clients.push('broker-1', files([], [application('LN-1001', 'borrower-1', 'Applied')], 'unavailable'));
    });

    expect(await screen.findByRole(nameRole, { name: displayName('Name unavailable') })).toBeInTheDocument();
    expect(screen.getByText(/Client names are not available yet/)).toBeInTheDocument();
    expect(screen.getByText('LN-1001')).toBeInTheDocument();
    expect(clients.subscriptions).toHaveLength(1);
  });
});
