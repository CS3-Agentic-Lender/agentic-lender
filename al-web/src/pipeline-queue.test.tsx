import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider } from './context/AuthContext';
import { PipelineServiceContext } from './context/PipelineContext';
import { AppRoutes } from './routes';
import { toApplicationSummary } from './services/clientsService';
import { withRiskTiers } from './services/pipelineService';
import type { AuthService, AuthStateListener, AuthUser, TrustedRole } from './services/authService';
import type {
  PipelineApplication,
  PipelineError,
  PipelineErrorListener,
  PipelineListener,
  PipelineService,
  PipelineSnapshot,
  RiskTier,
  RiskTierState,
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
    status,
    loanType: 'mortgage',
    loanAmountEur: 230000,
    ltvPct,
    riskTier,
    updatedAt: new Date('2026-10-05T10:00:00Z'),
  };
}

function queue(
  applications: PipelineApplication[],
  riskTierState: RiskTierState = 'available',
  riskTierError: PipelineError | null = null,
): PipelineSnapshot {
  return { applications, riskTierState, riskTierError };
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
  it.each(['', 'unknown', 1, {}])('shows invalid stored fields %j without valuation or review fallback', async (value) => {
    const rows = withRiskTiers([
      toApplicationSummary('invalid-band', { status: 'Applied', ltvBand: value, riskTier: 'D', ltvPct: 75 }),
      toApplicationSummary('invalid-tier', { status: 'Applied', riskTier: value, ltvPct: 85 }),
      toApplicationSummary('absent-tier', { status: 'Applied', ltvBand: value, riskTier: null, ltvPct: 75 }),
      toApplicationSummary('absent', { status: 'Applied', ltvBand: null, riskTier: null, ltvPct: 75 }),
    ], new Map<string, RiskTier>([
      ['invalid-band', 'A'], ['invalid-tier', 'A'], ['absent-tier', 'B'], ['absent', 'C'],
    ]));
    renderQueue(new FakePipelineService(queue(rows)));
    await screen.findByRole('table');
    const row = (id: string) => screen.getByRole('rowheader', { name: id }).closest('tr')!;
    expect(within(row('invalid-band')).getByText('Invalid stored band')).toBeInTheDocument();
    expect(within(row('invalid-band')).getByText('75%')).toBeInTheDocument();
    expect(within(row('invalid-band')).getByText('D')).toBeInTheDocument();
    expect(within(row('invalid-tier')).getByText('Invalid stored tier')).toBeInTheDocument();
    expect(within(row('invalid-tier')).getByText('>80% to 90%')).toBeInTheDocument();
    expect(within(row('absent-tier')).getByText('B')).toBeInTheDocument();
    expect(within(row('absent')).getByText('<=80%')).toBeInTheDocument();
    expect(within(row('absent')).getByText('C')).toBeInTheDocument();

    const user = userEvent.setup();
    for (const [groupBy, expected] of [
      ['LTV band', [['Invalid stored band', 2], ['<=80%', 1], ['>80% to 90%', 1]]],
      ['Risk tier', [['Invalid stored tier', 1], ['Tier B', 1], ['Tier C', 1], ['Tier D', 1]]],
    ] as const) {
      await user.click(screen.getByRole('radio', { name: groupBy }));
      for (const [label, count] of expected) {
        expect(within(group(label)).getByText(count === 1 ? '1 application' : '2 applications')).toBeInTheDocument();
      }
      expect(screen.getAllByRole('rowheader').filter((cell) => cell.getAttribute('scope') === 'row')).toHaveLength(4);
      expect(screen.getByText('Showing all 4 applications. Group counts are of all applications.')).toBeInTheDocument();
    }
  });

  it.each(['pending', 'unavailable'] as const)('keeps invalid tiers explicit while review fallback is %s', async (state) => {
    const rows = withRiskTiers([
      toApplicationSummary('invalid', { status: 'Applied', riskTier: '' }),
    ], new Map([['invalid', 'A']]));
    renderQueue(new FakePipelineService(queue(rows, state, state === 'unavailable' ? 'permission-denied' : null)));
    await screen.findByRole('table');
    const row = screen.getByRole('rowheader', { name: 'invalid' }).closest('tr')!;
    expect(within(row).getByText('Invalid stored tier')).toBeInTheDocument();
    expect(screen.queryByText(/Risk tiers could not be|Checking|^Unavailable$/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Risk tier' }));
    expect(within(group('Invalid stored tier')).getByText('1 application')).toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: /Checking risk tiers|Risk tier unavailable|Tier A/ })).not.toBeInTheDocument();
  });

  it('uses the stored asking-price band while labelling the 85% figure as valuation LTV', async () => {
    const rows = withRiskTiers([
      toApplicationSummary('stored', { status: 'Applied', ltvBand: 'over_90', riskTier: 'D', ltvPct: 85 }),
    ], new Map([['stored', 'A']]));
    renderQueue(new FakePipelineService(queue(rows)));
    await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: 'Valuation LTV' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'LTV band' }));
    expect(within(group('>90%')).getByRole('rowheader', { name: 'stored' })).toBeInTheDocument();
    expect(within(group('>90%')).getByText('85%')).toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: '>80% to 90%' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Risk tier' }));
    expect(within(group('Tier D')).getByText('D')).toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: 'Tier A' })).not.toBeInTheDocument();
  });

  it('groups all stored bands and tiers and falls back for each missing field independently', async () => {
    const rows = withRiskTiers([
      toApplicationSummary('both', { status: 'Applied', ltvBand: '80_or_less', riskTier: 'A', ltvPct: 95 }),
      toApplicationSummary('band-only', { status: 'Applied', ltvBand: '80_to_90', ltvPct: 75 }),
      toApplicationSummary('tier-only', { status: 'Declined', riskTier: 'C', ltvPct: 95 }),
      toApplicationSummary('high', { status: 'Declined', ltvBand: 'over_90', riskTier: 'D', ltvPct: 75 }),
      toApplicationSummary('invalid', { status: 'Applied', ltvBand: 'OVER_90', riskTier: 'a', ltvPct: 75 }),
      toApplicationSummary('neither', { status: 'Draft' }),
    ], new Map([['both', 'D'], ['band-only', 'B'], ['tier-only', 'A'], ['invalid', 'B']]));
    renderQueue(new FakePipelineService(queue(rows)));
    await screen.findByRole('table');
    const user = userEvent.setup();
    expect(within(group('Applied')).getByText('3 applications')).toBeInTheDocument();
    expect(within(group('Declined')).getByText('2 applications')).toBeInTheDocument();
    expect(within(group('Draft')).getByText('1 application')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'LTV band' }));
    for (const [label, ids] of [
      ['<=80%', ['both']],
      ['>80% to 90%', ['band-only']],
      ['>90%', ['tier-only', 'high']],
      ['No LTV yet', ['neither']],
      ['Invalid stored band', ['invalid']],
    ] as const) {
      expect(within(group(label)).getAllByRole('rowheader')
        .filter((row) => row.getAttribute('scope') === 'row')
        .map((row) => row.textContent).sort()).toEqual([...ids].sort());
      expect(within(group(label)).getByText(ids.length === 1 ? '1 application' : '2 applications')).toBeInTheDocument();
    }
    await user.click(screen.getByRole('radio', { name: 'Risk tier' }));
    for (const [label, ids] of [
      ['Tier A', ['both']], ['Tier B', ['band-only']],
      ['Tier C', ['tier-only']], ['Tier D', ['high']], ['No risk tier yet', ['neither']],
      ['Invalid stored tier', ['invalid']],
    ] as const) {
      expect(within(group(label)).getAllByRole('rowheader')
        .filter((row) => row.getAttribute('scope') === 'row')
        .map((row) => row.textContent).sort()).toEqual([...ids].sort());
    }
    expect(within(group('No risk tier yet')).getByText('No tier yet')).toBeInTheDocument();
  });

  it('moves rows and group counts when stored fields arrive without reloading', async () => {
    const raw = [
      toApplicationSummary('moving', { status: 'Applied', ltvPct: 75 }),
      toApplicationSummary('staying', { status: 'Applied', ltvPct: 75 }),
    ];
    const reviews = new Map<string, RiskTier>([['moving', 'A'], ['staying', 'A']]);
    const pipeline = new FakePipelineService(queue(withRiskTiers(raw, reviews)));
    renderQueue(pipeline);
    await screen.findByRole('table');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Risk tier' }));
    expect(within(group('Tier A')).getByText('2 applications')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'LTV band' }));
    expect(within(group('<=80%')).getByText('2 applications')).toBeInTheDocument();
    act(() => pipeline.push(queue(withRiskTiers([
      { ...raw[0], ltvBand: 'over_90', riskTier: 'D' }, raw[1],
    ], reviews))));
    expect(within(group('<=80%')).getByText('1 application')).toBeInTheDocument();
    expect(within(group('>90%')).getByText('1 application')).toBeInTheDocument();
    expect(within(group('>90%')).getByRole('rowheader', { name: 'moving' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Risk tier' }));
    expect(within(group('Tier D')).getByRole('rowheader', { name: 'moving' })).toBeInTheDocument();
    expect(within(group('Tier A')).getByText('1 application')).toBeInTheDocument();
    expect(within(group('Tier D')).getByText('1 application')).toBeInTheDocument();
    expect(pipeline.subscriptions).toHaveLength(1);
  });

  it.each(['pending', 'unavailable'] as const)(
    'only shows fallback %s states for listed applications without a stored tier', async (state) => {
      const stored = withRiskTiers([
        toApplicationSummary('stored', { status: 'Applied', riskTier: 'C' }),
      ], new Map());
      const pipeline = new FakePipelineService(queue([
        ...stored, application('fallback', 'Draft', null, null),
      ], state, state === 'unavailable' ? 'permission-denied' : null));
      renderQueue(pipeline);
      await screen.findByRole('table');
      const user = userEvent.setup();
      await user.click(screen.getByRole('radio', { name: 'Risk tier' }));
      expect(within(group('Tier C')).getByText('C')).toBeInTheDocument();
      const fallbackLabel = state === 'pending' ? 'Checking risk tiers' : 'Risk tier unavailable';
      expect(within(group(fallbackLabel)).getByRole('rowheader', { name: 'fallback' })).toBeInTheDocument();
      if (state === 'unavailable') {
        expect(screen.getByText(/Risk tiers could not be read for this account/)).toBeInTheDocument();
      }
      await user.selectOptions(screen.getByLabelText('Status filter'), 'Applied');
      expect(screen.queryByRole('rowgroup', { name: fallbackLabel })).not.toBeInTheDocument();
      expect(screen.queryByText(/Risk tiers could not be|Checking/)).not.toBeInTheDocument();
      act(() => pipeline.push(queue(stored, state, state === 'unavailable' ? 'permission-denied' : null)));
      await user.selectOptions(screen.getByLabelText('Status filter'), 'All statuses');
      expect(screen.queryByText(/Risk tiers could not be|Checking/)).not.toBeInTheDocument();
      expect(within(group('Tier C')).getByText('1 application')).toBeInTheDocument();
    },
  );

  it('shows applications while tiers are pending in one checking group without an unavailable notice', async () => {
    const withoutTiers = [applied, deliberated].map((item) => ({ ...item, riskTier: null }));
    renderQueue(new FakePipelineService(queue(withoutTiers, 'pending')));
    await screen.findByRole('rowheader', { name: 'LN-1001' });

    expect(screen.getAllByText('Checking')).toHaveLength(2);
    expect(screen.queryByText(/Risk tiers could not be (read for this account|loaded)/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Risk tier' }));

    expect(within(group('Checking risk tiers')).getByText('2 applications')).toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: 'Risk tier unavailable' })).not.toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: /^Tier / })).not.toBeInTheDocument();
  });

  it('re-groups when tiers arrive later without a reload or a new subscription', async () => {
    const pipeline = new FakePipelineService(queue([applied, deliberated], 'pending'));
    renderQueue(pipeline);
    await screen.findByRole('table');
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Risk tier' }));
    expect(within(group('Checking risk tiers')).getByText('2 applications')).toBeInTheDocument();

    act(() => pipeline.push(queue([applied, deliberated])));

    expect(within(group('Tier A')).getByRole('rowheader', { name: 'LN-1001' })).toBeInTheDocument();
    expect(within(group('Tier B')).getByRole('rowheader', { name: 'LN-1002' })).toBeInTheDocument();
    const row = screen.getByRole('rowheader', { name: 'LN-1002' }).closest('tr')!;
    expect(within(row).getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('Checking')).not.toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: 'Checking risk tiers' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Risk tiers could not be (read for this account|loaded)/)).not.toBeInTheDocument();
    expect(pipeline.subscriptions).toHaveLength(1);
  });

  it.each([
    ['permission-denied', 'Risk tiers could not be read for this account', 'Risk tiers could not be loaded'],
    ['unavailable', 'Risk tiers could not be loaded', 'Risk tiers could not be read for this account'],
  ] as const)('updates rows, grouping and notice when tiers fail later with %s', async (error, notice, absentNotice) => {
    const pipeline = new FakePipelineService(queue([applied, deliberated], 'pending'));
    renderQueue(pipeline);
    await screen.findByRole('table');
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Risk tier' }));

    act(() => pipeline.push(queue([applied, deliberated], 'unavailable', error)));

    expect(screen.getByText(new RegExp(notice))).toHaveAttribute('role', 'status');
    expect(screen.queryByText(new RegExp(absentNotice))).not.toBeInTheDocument();
    expect(within(group('Risk tier unavailable')).getByText('2 applications')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.queryByText('Checking')).not.toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: 'Checking risk tiers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: /^Tier / })).not.toBeInTheDocument();
    expect(pipeline.subscriptions).toHaveLength(1);
  });

  it('shows each LTV band beside its figure without grouping by LTV', async () => {
    renderQueue(new FakePipelineService(seededQueue));
    await screen.findByRole('table');

    for (const [id, figure, band] of [
      ['LN-1001', '72%', '<=80%'],
      ['LN-1002', '85.5%', '>80% to 90%'],
      ['LN-1003', '94%', '>90%'],
      ['LN-1004', '—', 'No LTV yet'],
    ]) {
      const row = screen.getByRole('rowheader', { name: id }).closest('tr')!;
      const cell = within(row).getByText(figure).closest('td')!;
      expect(within(cell).getByText(band)).toBeInTheDocument();
    }
  });

  it('shows a figure consistent with its band at a band edge', async () => {
    renderQueue(
      new FakePipelineService(
        queue([
          application('LN-2001', 'Applied', 80.04, 'A'),
          application('LN-2002', 'Applied', 90.04, 'B'),
        ]),
      ),
    );
    await screen.findByRole('table');

    for (const [id, figure, band] of [
      ['LN-2001', '80.04%', '>80% to 90%'],
      ['LN-2002', '90.04%', '>90%'],
    ]) {
      const row = screen.getByRole('rowheader', { name: id }).closest('tr')!;
      const cell = within(row).getByText(figure).closest('td')!;
      expect(within(cell).getByText(band)).toBeInTheDocument();
    }
  });

  it('shows a dash beside "No LTV yet" for a negative LTV', async () => {
    renderQueue(new FakePipelineService(queue([application('LN-2003', 'Applied', -5, 'A')])));
    await screen.findByRole('table');

    const row = screen.getByRole('rowheader', { name: 'LN-2003' }).closest('tr')!;
    const cell = within(row).getByText('—').closest('td')!;
    expect(within(cell).getByText('No LTV yet')).toBeInTheDocument();
    expect(within(row).queryByText(/-5|^0%/)).not.toBeInTheDocument();
  });

  it('shows an underwriter every application with its figures, tier and status', async () => {
    renderQueue(new FakePipelineService(seededQueue));

    const row = (await screen.findByRole('rowheader', { name: 'LN-1002' })).closest('tr')!;
    expect(screen.getByRole('heading', { level: 1, name: 'Pipeline queue' })).toBeInTheDocument();
    expect(within(row).getByText('€230,000')).toBeInTheDocument();
    expect(within(row).getByText('85.5%')).toBeInTheDocument();
    expect(within(row).getByText('>80% to 90%')).toBeInTheDocument();
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
    renderQueue(new FakePipelineService(queue(withoutTiers, 'unavailable', 'permission-denied')));
    const user = userEvent.setup();
    await screen.findByRole('table');

    expect(screen.getByText(/Risk tiers could not be read for this account/)).toBeInTheDocument();
    const row = screen.getByRole('rowheader', { name: 'LN-1001' }).closest('tr')!;
    expect(within(row).getByText('Unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Risk tier' }));
    expect(within(group('Risk tier unavailable')).getByText('2 applications')).toBeInTheDocument();
    expect(screen.queryByRole('rowgroup', { name: /^Tier / })).not.toBeInTheDocument();
  });

  it('shows no tier notice when tiers can be read', async () => {
    renderQueue(new FakePipelineService(seededQueue));
    await screen.findByRole('table');

    expect(screen.queryByText(/Risk tiers could not be read for this account/)).not.toBeInTheDocument();
  });

  it('shows a loading state before the first answer and no table', async () => {
    renderQueue(new FakePipelineService());

    expect(await screen.findByRole('heading', { name: 'Loading the pipeline' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the pipeline');
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-live');
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
    expect(screen.getByRole('status')).toHaveTextContent(heading);
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-live');
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
