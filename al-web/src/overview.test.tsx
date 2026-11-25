import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './context/AuthContext';
import { ClientsServiceContext } from './context/BrokerClientsContext';
import { MessagesServiceContext } from './context/MessagesContext';
import { OverviewServiceContext } from './context/OverviewContext';
import { PipelineServiceContext } from './context/PipelineContext';
import { AppRoutes, preloadPages } from './routes';
import type { AuthService, AuthStateListener, AuthUser, TrustedRole } from './services/authService';
import {
  buildBrokerClients,
  type BrokerApplication,
  type BrokerClientsSnapshot,
  type ClientsService,
  type StatusMove,
} from './services/clientsService';
import type { CommitteeRun } from './services/committeeService';
import type { LiveError } from './services/liveCollection';
import type { MessagesService, ThreadSnapshot } from './services/messagesService';
import type { OverviewService } from './services/overviewService';
import type {
  PipelineApplication,
  PipelineError,
  PipelineListener,
  PipelineService,
} from './services/pipelineService';

// The page chunks load before any test renders a route, so a busy machine's slow first import is not timed.
await preloadPages();

// Wednesday 25 November 2026, local time; the week began on Monday 23 November.
const local = (day: number, hour = 12) => new Date(2026, 10, day, hour);
const NOW = local(25);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

class FakeAuthService implements AuthService {
  constructor(
    private readonly user: AuthUser,
    private readonly role: TrustedRole,
  ) {}

  subscribe(listener: AuthStateListener) {
    listener(this.user);
    return () => {};
  }

  async signIn() {}
  async signOut() {}
  async resolveTrustedRole() {
    return { role: this.role, denialReason: null };
  }
  async getCurrentIdToken() {
    return 'id-token';
  }
}

function authUser(uid: string): AuthUser {
  return {
    uid,
    email: `${uid}@example.test`,
    getIdToken: async () => 'id-token',
    getIdTokenResult: async () => ({ claims: {} }) as never,
  };
}

function move(to: string, at: Date, from: string | null, actor: string, actorId: string): StatusMove {
  return { from, to, actor, actorId, at };
}

// The value and detail of the stat tile with this label.
function tile(label: string) {
  const card = screen.getByText(label, { selector: 'p' }).parentElement as HTMLElement;
  return card.textContent ?? '';
}

function renderAt(path: string, uid: string, role: TrustedRole, providers: (children: ReactNode) => ReactNode) {
  return render(
    <AuthProvider service={new FakeAuthService(authUser(uid), role)}>
      {providers(
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>,
      )}
    </AuthProvider>,
  );
}

// ---------- underwriter ----------

class FakePipeline implements PipelineService {
  listener: PipelineListener | null = null;
  onError: ((error: PipelineError) => void) | null = null;

  subscribeToPipeline(listener: PipelineListener, onError: (error: PipelineError) => void) {
    this.listener = listener;
    this.onError = onError;
    return () => {
      this.listener = null;
    };
  }

  async push(applications: PipelineApplication[]) {
    await waitFor(() => expect(this.listener).not.toBeNull());
    act(() => this.listener?.({ applications, riskTierState: 'available', riskTierError: null }));
  }

  async fail(error: PipelineError) {
    await waitFor(() => expect(this.onError).not.toBeNull());
    act(() => this.onError?.(error));
  }
}

function pipelineApp(id: string, status: string, extra: Partial<PipelineApplication> = {}): PipelineApplication {
  return {
    id,
    status,
    loanType: 'mortgage',
    borrowerName: null,
    loanAmountEur: 250000,
    ltvPct: null,
    riskTier: null,
    updatedAt: local(1),
    ...extra,
  };
}

const underwriterQueue = [
  pipelineApp('LN-2002', 'AI Deliberated', {
    borrowerName: 'Ben Walsh',
    ltvPct: 90,
    riskTier: 'B',
    statusHistory: [
      move('Applied', local(20), 'Draft', 'borrower', 'ben'),
      move('AI Deliberated', local(24), 'Applied', 'committee', 'al-ai'),
    ],
  }),
  pipelineApp('LN-2001', 'AI Deliberated', {
    borrowerName: 'Alice Byrne',
    ltvPct: 80,
    riskTier: 'A',
    statusHistory: [move('AI Deliberated', local(21), 'Applied', 'committee', 'al-ai')],
  }),
  pipelineApp('LN-2003', 'Applied', { aiRunStatus: 'running', ltvPct: 70 }),
  pipelineApp('LN-2004', 'Underwriter Approved', {
    ltvPct: 60,
    statusHistory: [move('Underwriter Approved', local(25, 9), 'AI Deliberated', 'underwriter', 'uw-1')],
  }),
  pipelineApp('LN-2005', 'Underwriter Approved', {
    statusHistory: [move('Underwriter Approved', local(18), 'AI Deliberated', 'underwriter', 'uw-2')],
  }),
  pipelineApp('LN-2006', 'Draft', { ltvPct: 99 }),
];

function renderUnderwriter(pipeline: FakePipeline) {
  return renderAt('/underwriter', 'uw-1', 'underwriter', (children) => (
    <PipelineServiceContext.Provider value={pipeline}>{children}</PipelineServiceContext.Provider>
  ));
}

describe('underwriter overview', () => {
  it('computes the four tiles from the stored applications', async () => {
    const pipeline = new FakePipeline();
    renderUnderwriter(pipeline);
    await pipeline.push(underwriterQueue);

    expect(tile('Awaiting decision')).toContain('2');
    expect(tile('Awaiting decision')).toContain('Oldest waiting since 21 Nov 2026');
    expect(tile('AI running')).toContain('1');
    // LN-2004 was approved this morning; LN-2005 last week.
    expect(tile('Approved this week')).toMatch(/^Approved this week1/);
    // 90, 80, 70 and 60: the Draft is left out.
    expect(tile('Average indicative LTV')).toContain('75%');
    expect(tile('Average indicative LTV')).toContain('Across 4 applications with a stored LTV');
  });

  it('lists the AI Deliberated files oldest first, each linking to its loan file', async () => {
    const pipeline = new FakePipeline();
    renderUnderwriter(pipeline);
    await pipeline.push(underwriterQueue);

    const table = screen.getByRole('table', { name: 'Applications waiting for your decision, oldest first' });
    const links = within(table).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['LN-2001', 'LN-2002']);
    expect(links[0]).toHaveAttribute('href', '/underwriter/applications/LN-2001');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Alice Byrne');
  });

  it('shows the latest status moves newest first, naming the actor', async () => {
    const pipeline = new FakePipeline();
    renderUnderwriter(pipeline);
    await pipeline.push(underwriterQueue);

    const feed = screen.getByRole('list', { name: 'Recent status moves' });
    const items = within(feed).getAllByRole('listitem');
    expect(items.map((item) => within(item).getByRole('link').textContent)).toEqual([
      'LN-2004',
      'Ben Walsh, LN-2002',
      'Alice Byrne, LN-2001',
      'Ben Walsh, LN-2002',
      'LN-2005',
    ]);
    expect(items[0]).toHaveTextContent('By you');
    expect(items[1]).toHaveTextContent('By the AI committee');
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', '/underwriter/applications/LN-2004');
  });

  it('shows placeholders while loading, then the empty states', async () => {
    const pipeline = new FakePipeline();
    renderUnderwriter(pipeline);

    expect(await screen.findByRole('heading', { name: 'Underwriter portal' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the overview');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await pipeline.push([pipelineApp('LN-2003', 'Applied')]);
    expect(screen.getByText(/Nothing waiting for you/)).toBeInTheDocument();
    expect(screen.getByText('No status moves recorded yet.')).toBeInTheDocument();
    expect(tile('Average indicative LTV')).toContain('No submitted application has a stored LTV yet');
  });

  it('says in place when the applications cannot be read', async () => {
    const pipeline = new FakePipeline();
    renderUnderwriter(pipeline);
    await pipeline.fail('unavailable');

    expect(screen.getByRole('alert')).toHaveTextContent('The applications could not be loaded');
    expect(screen.queryByText('Awaiting decision')).not.toBeInTheDocument();
  });
});

// ---------- broker ----------

class FakeClients implements ClientsService {
  uids: string[] = [];
  listener: ((snapshot: BrokerClientsSnapshot) => void) | null = null;
  onError: ((error: 'permission-denied' | 'unavailable') => void) | null = null;

  subscribeToBrokerClients: ClientsService['subscribeToBrokerClients'] = (uid, listener, onError) => {
    this.uids.push(uid);
    this.listener = listener;
    this.onError = onError;
    return () => {
      this.listener = null;
    };
  };

  async push(snapshot: BrokerClientsSnapshot) {
    await waitFor(() => expect(this.listener).not.toBeNull());
    act(() => this.listener?.(snapshot));
  }

  async fail() {
    await waitFor(() => expect(this.onError).not.toBeNull());
    act(() => this.onError?.('permission-denied'));
  }
}

class FakeOverview implements OverviewService {
  uids: string[] = [];
  listener: ((runs: CommitteeRun[]) => void) | null = null;
  onError: ((error: LiveError) => void) | null = null;

  subscribeToBrokerRuns: OverviewService['subscribeToBrokerRuns'] = (uid, listener, onError) => {
    this.uids.push(uid);
    this.listener = listener;
    this.onError = onError;
    return () => {
      this.listener = null;
    };
  };

  async push(runs: CommitteeRun[]) {
    await waitFor(() => expect(this.listener).not.toBeNull());
    act(() => this.listener?.(runs));
  }

  async fail() {
    await waitFor(() => expect(this.onError).not.toBeNull());
    act(() => this.onError?.('permission-denied'));
  }
}

class FakeMessages implements MessagesService {
  listeners = new Map<string, (snapshot: ThreadSnapshot) => void>();
  send = vi.fn<MessagesService['send']>().mockResolvedValue(undefined);
  markRead = vi.fn<MessagesService['markRead']>().mockResolvedValue(undefined);

  subscribeToThread: MessagesService['subscribeToThread'] = (id, _uid, listener) => {
    this.listeners.set(id, listener);
    return () => this.listeners.delete(id);
  };

  async push(id: string, snapshot: ThreadSnapshot) {
    await waitFor(() => expect(this.listeners.has(id)).toBe(true));
    act(() => this.listeners.get(id)?.(snapshot));
  }
}

function brokerApp(id: string, borrowerId: string, status: string, extra: Partial<BrokerApplication> = {}): BrokerApplication {
  return { id, borrowerId, status, loanType: 'mortgage', loanAmountEur: 200000, ltvPct: null, updatedAt: null, ...extra };
}

const brokerApplications = [
  brokerApp('LN-3001', 'alice', 'Applied', { updatedAt: local(19) }),
  brokerApp('LN-3002', 'alice', 'AI Deliberated', {
    aiRunId: 'run-2',
    updatedAt: local(22),
    statusHistory: [move('AI Deliberated', local(22), 'Applied', 'committee', 'al-ai')],
  }),
  brokerApp('LN-3003', 'ben', 'Underwriter Approved', { aiRunId: 'run-3', updatedAt: local(23) }),
  brokerApp('LN-3004', 'ben', 'Funded', {
    statusHistory: [move('Funded', local(24), 'Underwriter Approved', 'mint', 'al-core')],
  }),
  brokerApp('LN-3005', 'cara', 'Declined', {
    updatedAt: local(24),
    statusHistory: [move('Declined', local(23), 'AI Deliberated', 'underwriter', 'uw-1')],
  }),
];

const brokerSnapshot: BrokerClientsSnapshot = {
  clients: buildBrokerClients(
    [
      { uid: 'alice', fullName: 'Alice Byrne', email: null, county: null },
      { uid: 'ben', fullName: 'Ben Walsh', email: null, county: null },
      { uid: 'cara', fullName: 'Cara Doyle', email: null, county: null },
    ],
    brokerApplications,
  ),
  profilesState: 'available',
};

const runs = [
  { id: 'run-2', applicationId: 'LN-3002', brokerId: 'broker-1', policyGate: { conditions: ['Provide recent payslips'] } },
  { id: 'run-3', applicationId: 'LN-3003', brokerId: 'broker-1', policyGate: { conditions: [] } },
] as unknown as CommitteeRun[];

function renderBroker(clients: FakeClients, overview: FakeOverview, messages: FakeMessages) {
  return renderAt('/broker', 'broker-1', 'broker', (children) => (
    <ClientsServiceContext.Provider value={clients}>
      <OverviewServiceContext.Provider value={overview}>
        <MessagesServiceContext.Provider value={messages}>{children}</MessagesServiceContext.Provider>
      </OverviewServiceContext.Provider>
    </ClientsServiceContext.Provider>
  ));
}

const borrowerMessage = (id: string, iso: string) => ({
  id, senderId: 'alice', senderRole: 'borrower' as const, text: 'Any news?', sentAt: new Date(iso),
});

async function pushThreads(messages: FakeMessages) {
  await messages.push('LN-3001', {
    messages: [borrowerMessage('m1', '2026-11-20T10:00:00Z'), borrowerMessage('m2', '2026-11-24T10:00:00Z')],
    lastReadAt: new Date('2026-11-21T10:00:00Z'),
  });
  for (const id of ['LN-3002', 'LN-3003', 'LN-3004', 'LN-3005']) {
    await messages.push(id, { messages: [], lastReadAt: null });
  }
}

describe('broker overview', () => {
  it('asks for the signed-in broker\'s data only', async () => {
    const clients = new FakeClients();
    const overview = new FakeOverview();
    renderBroker(clients, overview, new FakeMessages());
    await clients.push(brokerSnapshot);

    expect(clients.uids).toEqual(['broker-1']);
    await waitFor(() => expect(overview.uids).toEqual(['broker-1']));
  });

  it('computes the tiles, including unread messages from the thread read state', async () => {
    const clients = new FakeClients();
    const messages = new FakeMessages();
    renderBroker(clients, new FakeOverview(), messages);
    await clients.push(brokerSnapshot);
    await pushThreads(messages);

    expect(tile('Active applications')).toMatch(/^Active applications3/);
    expect(tile('Awaiting AI')).toMatch(/^Awaiting AI1/);
    expect(tile('Approved')).toMatch(/^Approved2/);
    expect(tile('Approved')).toContain('1 waiting to be funded');
    expect(tile('Unread messages')).toMatch(/^Unread messages1/);
  });

  it('lists declined files, conditions to meet and new messages, newest first, linking to the loan file', async () => {
    const clients = new FakeClients();
    const overview = new FakeOverview();
    const messages = new FakeMessages();
    renderBroker(clients, overview, messages);
    await clients.push(brokerSnapshot);
    await overview.push(runs);
    await pushThreads(messages);

    const list = screen.getByRole('list', { name: 'Applications that need attention' });
    const rows = within(list).getAllByRole('listitem').filter((item) => item.parentElement === list);
    expect(rows.map((row) => within(row).getAllByRole('link')[0].textContent)).toEqual([
      'Cara DoyleLN-3005',
      'Alice ByrneLN-3002',
      'Alice ByrneLN-3001',
    ]);
    expect(within(rows[0]).getAllByRole('link')[0]).toHaveAttribute('href', '/broker/applications/LN-3005');
    expect(rows[0]).toHaveTextContent('Declined');
    expect(rows[1]).toHaveTextContent('Provide recent payslips');
    expect(rows[1]).toHaveTextContent('1 condition to meet');
    expect(rows[2]).toHaveTextContent('1 new message');
  });

  it('shows recent status changes on the broker\'s clients, newest first', async () => {
    const clients = new FakeClients();
    renderBroker(clients, new FakeOverview(), new FakeMessages());
    await clients.push(brokerSnapshot);

    const feed = screen.getByRole('list', { name: 'Recent status changes' });
    expect(within(feed).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Ben Walsh, LN-3004',
      'Cara Doyle, LN-3005',
      'Alice Byrne, LN-3002',
    ]);
    expect(within(feed).getAllByRole('listitem')[0]).toHaveTextContent('By the loan note mint');
  });

  it('shows placeholders while loading and clear empty states', async () => {
    const clients = new FakeClients();
    const overview = new FakeOverview();
    renderBroker(clients, overview, new FakeMessages());

    expect(await screen.findByRole('heading', { name: 'Broker portal' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the overview');

    await clients.push({ clients: [], profilesState: 'available' });
    await overview.push([]);
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument();
    expect(screen.getByText('No status changes recorded yet.')).toBeInTheDocument();
    expect(tile('Unread messages')).toMatch(/^Unread messages0/);
  });

  it('says in place when the applications cannot be read', async () => {
    const clients = new FakeClients();
    renderBroker(clients, new FakeOverview(), new FakeMessages());
    await clients.fail();

    expect(screen.getByRole('alert')).toHaveTextContent("Your clients' applications could not be loaded");
  });

  it('keeps the page when the committee runs are refused, and says conditions are not checked', async () => {
    const clients = new FakeClients();
    const overview = new FakeOverview();
    renderBroker(clients, overview, new FakeMessages());
    await clients.push(brokerSnapshot);
    await overview.fail();

    expect(screen.getByText(/Committee conditions could not be loaded/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Applications that need attention' });
    expect(list).toHaveTextContent('Cara Doyle');
    expect(list).not.toHaveTextContent('Provide recent payslips');
  });
});
