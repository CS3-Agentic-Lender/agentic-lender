import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider } from './context/AuthContext';
import { PipelineServiceContext } from './context/PipelineContext';
import { AppRoutes } from './routes';
import type { AuthService, AuthStateListener, AuthUser, TrustedRole } from './services/authService';
import type {
  PipelineApplication,
  PipelineError,
  PipelineErrorListener,
  PipelineListener,
  PipelineService,
  PipelineSnapshot,
  RiskTier,
} from './services/pipelineService';

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
  listener: PipelineListener;
  onError: PipelineErrorListener;
  active: boolean;
}

class FakePipelineService implements PipelineService {
  readonly subscriptions: Subscription[] = [];

  constructor(private readonly initial: PipelineSnapshot | null = null) {}

  subscribeToPipeline(listener: PipelineListener, onError: PipelineErrorListener) {
    const subscription: Subscription = { listener, onError, active: true };
    this.subscriptions.push(subscription);

    if (this.initial) {
      listener(this.initial);
    }

    return () => {
      subscription.active = false;
    };
  }

  push(snapshot: PipelineSnapshot) {
    this.active().forEach(({ listener }) => listener(snapshot));
  }

  fail(error: PipelineError) {
    this.active().forEach(({ onError }) => onError(error));
  }

  private active() {
    return this.subscriptions.filter((subscription) => subscription.active);
  }
}

function application(
  id: string,
  status: string,
  ltvPct: number | null,
  riskTier: RiskTier | null,
): PipelineApplication {
  return {
    id,
    borrowerId: 'borrower-1',
    status,
    loanType: 'mortgage',
    loanAmountEur: 230000,
    ltvPct,
    riskTier,
    updatedAt: new Date('2026-10-05T10:00:00Z'),
  };
}

function queue(applications: PipelineApplication[], riskTiersAvailable = true): PipelineSnapshot {
  return { applications, riskTiersAvailable };
}

const applied = application('LN-1001', 'Applied', 72, 'A');
const deliberated = application('LN-1002', 'AI Deliberated', 85.5, 'B');
const declined = application('LN-1003', 'Declined', 94, 'D');
const draft = application('LN-1004', 'Draft', null, null);

const seededQueue = queue([applied, deliberated, declined, draft]);

function renderAs(uid: string, role: TrustedRole, pathname: string, pipeline: FakePipelineService) {
  return render(
    <AuthProvider service={new FakeAuthService(authUser(uid), role)}>
      <PipelineServiceContext.Provider value={pipeline}>
        <MemoryRouter initialEntries={[pathname]}>
          <AppRoutes />
        </MemoryRouter>
      </PipelineServiceContext.Provider>
    </AuthProvider>,
  );
}

function renderQueue(pipeline: FakePipelineService) {
  return renderAs('underwriter-1', 'underwriter', '/underwriter/pipeline', pipeline);
}

// A group is the table body named by its group heading.
function group(name: string) {
  return screen.getByRole('rowgroup', { name });
}

afterEach(cleanup);

describe('underwriter pipeline queue', () => {
  it('shows an underwriter every application with its figures, tier and status', async () => {
    renderQueue(new FakePipelineService(seededQueue));

    const row = (await screen.findByRole('rowheader', { name: 'LN-1002' })).closest('tr')!;
    expect(screen.getByRole('heading', { level: 1, name: 'Pipeline queue' })).toBeInTheDocument();
    expect(within(row).getByText('€230,000')).toBeInTheDocument();
    expect(within(row).getByText('85.5%')).toBeInTheDocument();
    expect(within(row).getByText('B')).toBeInTheDocument();
    expect(within(row).getByText('AI Deliberated')).toBeInTheDocument();
    expect(within(row).getByText('5 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText(/Showing all 4 applications\. Group counts are of all applications\./)).toBeInTheDocument();
  });

  it('groups by status first, with a count on each group', async () => {
    renderQueue(new FakePipelineService(queue([applied, application('LN-1005', 'Applied', 80, 'A'), declined])));
    await screen.findByRole('table');

    expect(screen.getByRole('radio', { name: 'Status' })).toBeChecked();
    expect(within(group('Applied')).getByText('2 applications')).toBeInTheDocument();
    expect(within(group('Declined')).getByText('1 application')).toBeInTheDocument();
    expect(within(group('Applied')).getByRole('rowheader', { name: 'LN-1005' })).toBeInTheDocument();
  });

  it('switches the grouping to LTV band and to risk tier', async () => {
    renderQueue(new FakePipelineService(seededQueue));
    const user = userEvent.setup();
    await screen.findByRole('table');

    await user.click(screen.getByRole('radio', { name: 'LTV band' }));
    expect(within(group('<=80%')).getByRole('rowheader', { name: 'LN-1001' })).toBeInTheDocument();
    expect(within(group('>80% to 90%')).getByRole('rowheader', { name: 'LN-1002' })).toBeInTheDocument();
    expect(within(group('>90%')).getByRole('rowheader', { name: 'LN-1003' })).toBeInTheDocument();
    expect(within(group('No LTV yet')).getByRole('rowheader', { name: 'LN-1004' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Risk tier' }));
    expect(within(group('Tier A')).getByRole('rowheader', { name: 'LN-1001' })).toBeInTheDocument();
    expect(within(group('Tier D')).getByRole('rowheader', { name: 'LN-1003' })).toBeInTheDocument();
    expect(within(group('No risk tier yet')).getByRole('rowheader', { name: 'LN-1004' })).toBeInTheDocument();
    expect(within(group('No risk tier yet')).getByText('No tier yet')).toBeInTheDocument();
  });

  it('filters by status and says the counts are of the filtered applications', async () => {
    renderQueue(new FakePipelineService(seededQueue));
    const user = userEvent.setup();
    await screen.findByRole('table');
    await user.click(screen.getByRole('radio', { name: 'LTV band' }));

    await user.selectOptions(screen.getByLabelText('Status filter'), 'Declined');

    expect(
      screen.getByText(
        'Showing 1 of 4 applications, filtered to Declined. Group counts are of the filtered applications only.',
      ),
    ).toBeInTheDocument();
    expect(within(group('>90%')).getByText('1 application')).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'LN-1001' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status filter'), 'Funded');
    expect(screen.getByText('No applications match this status.')).toBeInTheDocument();
    expect(screen.getByText(/Showing 0 of 4 applications, filtered to Funded\./)).toBeInTheDocument();
  });

  it('offers exactly the agreed lifecycle statuses in the filter', async () => {
    renderQueue(new FakePipelineService(seededQueue));
    await screen.findByRole('table');

    const options = within(screen.getByLabelText('Status filter')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'All statuses',
      'Draft',
      'Applied',
      'AI Deliberated',
      'Underwriter Approved',
      'Declined',
      'Funded',
      'Closed',
    ]);
  });

  it('changes a group count without a reload when an application moves on', async () => {
    const pipeline = new FakePipelineService(seededQueue);
    renderQueue(pipeline);
    await screen.findByRole('table');
    expect(within(group('Applied')).getByText('1 application')).toBeInTheDocument();

    act(() => {
      pipeline.push(queue([applied, { ...draft, status: 'Applied' }, deliberated, declined]));
    });

    expect(within(group('Applied')).getByText('2 applications')).toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: 'Draft' })).not.toBeInTheDocument();
  });

  it('says tiers are unavailable instead of showing any when they cannot be read', async () => {
    const withoutTiers = [applied, deliberated].map((item) => ({ ...item, riskTier: null }));
    renderQueue(new FakePipelineService(queue(withoutTiers, false)));
    const user = userEvent.setup();
    await screen.findByRole('table');

    expect(screen.getByText(/Risk tiers are not available yet/)).toBeInTheDocument();
    const row = screen.getByRole('rowheader', { name: 'LN-1001' }).closest('tr')!;
    expect(within(row).getByText('Unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Risk tier' }));
    expect(within(group('Risk tier unavailable')).getByText('2 applications')).toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: /^Tier / })).not.toBeInTheDocument();
  });

  it('shows no tier notice when tiers can be read', async () => {
    renderQueue(new FakePipelineService(seededQueue));
    await screen.findByRole('table');

    expect(screen.queryByText(/Risk tiers are not available yet/)).not.toBeInTheDocument();
  });

  it('shows a loading state before the first answer and no table', async () => {
    renderQueue(new FakePipelineService());

    expect(await screen.findByRole('heading', { name: 'Loading the pipeline' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says so when there are no applications', async () => {
    renderQueue(new FakePipelineService(queue([])));

    expect(await screen.findByRole('heading', { name: 'No applications yet' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it.each([
    ['permission-denied', 'The pipeline is not available'],
    ['unavailable', 'The pipeline could not be loaded'],
  ] as const)('shows a clear state for a %s failure and drops the rows', async (error, heading) => {
    const pipeline = new FakePipelineService(seededQueue);
    renderQueue(pipeline);
    await screen.findByRole('table');

    act(() => {
      pipeline.fail(error);
    });

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByText('LN-1001')).not.toBeInTheDocument();
  });

  it('stops listening when the underwriter signs out', async () => {
    const pipeline = new FakePipelineService(seededQueue);
    renderQueue(pipeline);
    await screen.findByRole('table');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Portal access' })).toBeInTheDocument();
    expect(pipeline.subscriptions).toHaveLength(1);
    expect(pipeline.subscriptions.every(({ active }) => !active)).toBe(true);
    expect(screen.queryByText('LN-1001')).not.toBeInTheDocument();
  });

  it('stops listening when the page is left', async () => {
    const pipeline = new FakePipelineService(seededQueue);
    const view = renderQueue(pipeline);
    await screen.findByRole('table');

    view.unmount();

    expect(pipeline.subscriptions.every(({ active }) => !active)).toBe(true);
  });

  it('refuses a broker and never subscribes for them', async () => {
    const pipeline = new FakePipelineService(seededQueue);
    renderAs('broker-1', 'broker', '/underwriter/pipeline', pipeline);

    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
    expect(pipeline.subscriptions).toHaveLength(0);
    expect(screen.queryByText('LN-1001')).not.toBeInTheDocument();
  });

  it('is reached from the underwriter navigation', async () => {
    renderAs('underwriter-1', 'underwriter', '/underwriter', new FakePipelineService(seededQueue));

    await userEvent.setup().click(await screen.findByRole('link', { name: 'Pipeline' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pipeline queue' })).toBeInTheDocument();
  });
});
