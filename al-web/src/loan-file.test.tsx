import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './context/AuthContext';
import { CommitteeServiceContext } from './context/CommitteeContext';
import type { CommitteeService } from './services/committeeService';
import { ClientsServiceContext } from './context/BrokerClientsContext';
import { LoanFileServiceContext } from './context/LoanFileContext';
import { DecisionServiceContext } from './context/DecisionContext';
import { SettlementServiceContext } from './context/SettlementContext';
import { ApiError } from './services/apiClient';
import type { SettlementResult, SettlementService } from './services/settlementService';
import type { DecisionResult, DecisionService } from './services/decisionService';
import { PipelineServiceContext } from './context/PipelineContext';
import { AppRoutes } from './routes';
import type { AuthService, AuthStateListener, AuthUser, TrustedRole } from './services/authService';
import {
  buildBrokerClients,
  toApplicationSummary,
  toBrokerApplication,
  type BrokerApplication,
  type ClientsService,
} from './services/clientsService';
import {
  toLoanFileApplication,
  toLoanFileReview,
  type LoanFileError,
  type LoanFileErrorListener,
  type LoanFileListener,
  type LoanFileReview,
  type LoanFileService,
  type LoanFileUpdate,
} from './services/loanFileService';
import { withRiskTiers, type PipelineService } from './services/pipelineService';

function authUser(uid: string): AuthUser {
  return {
    uid,
    email: `${uid}@example.test`,
    getIdToken: async () => 'id-token',
    getIdTokenResult: async () => ({ claims: {} }) as never,
  };
}

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

interface Subscription {
  applicationId: string;
  listener: LoanFileListener;
  onError: LoanFileErrorListener;
  active: boolean;
}

// Answers each subscription with the file stored for its application ID, if any.
class FakeLoanFileService implements LoanFileService {
  readonly subscriptions: Subscription[] = [];

  constructor(private readonly files: Record<string, LoanFileUpdate> = {}) {}

  subscribeToLoanFile(applicationId: string, listener: LoanFileListener, onError: LoanFileErrorListener) {
    const subscription: Subscription = { applicationId, listener, onError, active: true };
    this.subscriptions.push(subscription);

    const file = this.files[applicationId];
    if (file) {
      listener(file);
    }

    return () => {
      subscription.active = false;
    };
  }

  push(update: LoanFileUpdate) {
    this.active().forEach(({ listener }) => listener(update));
  }

  fail(error: LoanFileError) {
    this.active().forEach(({ onError }) => onError(error));
  }

  active() {
    return this.subscriptions.filter((subscription) => subscription.active);
  }
}

const seededApplication = {
  borrowerId: 'borrower-1',
  borrowerName: 'Alice Byrne',
  brokerId: 'broker-1',
  status: 'AI Deliberated',
  loanType: 'mortgage',
  grossIncomeEur: 75000,
  monthlyDebtsEur: 300,
  loanAmountEur: 265000,
  termYears: 30,
  aprPct: 4,
  dtiPct: 33.4,
  ltvPct: 86.6,
  ltvBand: '80_to_90',
  riskTier: 'B',
  property: {
    county: 'Cork',
    propertyType: 'Semi-D',
    bedrooms: 3,
    floorAreaSqm: 98,
    berRating: 'C2',
    askingPriceEur: 310000,
  },
};

const seededReview = {
  riskTier: 'B',
  valuationDetail: {
    baselineEur: 250000,
    contributions: [
      { feature: 'floor_area', value: 98, eur: 31200 },
      { feature: 'county', value: 'Cork', eur: 18500 },
      { feature: 'bedrooms', value: 3, eur: 9800 },
      { feature: 'eircode_area', value: 'T12', eur: 6400 },
      { feature: 'property_type', value: 'Semi-D', eur: -4600 },
      { feature: 'ber', value: 'C2', eur: -1300 },
    ],
    estimatedValueEur: 310000,
    supportWarnings: [],
  },
  dtiBreakdown: { incomeMonthlyEur: 6250, existingDebtsMonthlyEur: 300, newRepaymentMonthlyEur: 1265.13 },
};

function loanFile(
  id = 'LN-1001',
  data: Record<string, unknown> = seededApplication,
  review: LoanFileReview = toLoanFileReview(seededReview),
): LoanFileUpdate {
  return { status: 'ready', application: toLoanFileApplication(id, data), review };
}

let navigateTo: NavigateFunction = () => {};
let currentPath = '';

function NavigationProbe() {
  navigateTo = useNavigate();
  currentPath = useLocation().pathname;
  return null;
}

interface Services {
  settlement?: SettlementService;
  decisions?: DecisionService;
  loanFiles?: LoanFileService;
  pipeline?: PipelineService;
  clients?: ClientsService;
}

const noCommittee: CommitteeService = {
  subscribeToRun: (_id, _viewer, listener) => {
    listener({ status: 'missing' });
    return () => {};
  },
  subscribeToCalls: () => () => {},
};

function renderAs(uid: string, role: TrustedRole, pathname: string, services: Services) {
  return render(
    <AuthProvider service={new FakeAuthService(authUser(uid), role)}>
      <CommitteeServiceContext.Provider value={noCommittee}>
        <SettlementServiceContext.Provider value={services.settlement ?? { mint: async (id) => ({ id, status: 'Funded' }) }}>
        <DecisionServiceContext.Provider value={services.decisions ?? { signOff: async () => { throw new Error('No decision fake configured'); } }}>
        <LoanFileServiceContext.Provider value={services.loanFiles ?? new FakeLoanFileService()}>
          <PipelineServiceContext.Provider value={services.pipeline ?? { subscribeToPipeline: () => () => {} }}>
            <ClientsServiceContext.Provider value={services.clients ?? { subscribeToBrokerClients: () => () => {} }}>
              <MemoryRouter initialEntries={[pathname]}>
                <AppRoutes />
                <NavigationProbe />
              </MemoryRouter>
            </ClientsServiceContext.Provider>
          </PipelineServiceContext.Provider>
        </LoanFileServiceContext.Provider>
        </DecisionServiceContext.Provider>
        </SettlementServiceContext.Provider>
      </CommitteeServiceContext.Provider>
    </AuthProvider>,
  );
}

function renderUnderwriterFile(loanFiles: FakeLoanFileService, id = 'LN-1001') {
  return renderAs('underwriter-1', 'underwriter', `/underwriter/applications/${id}`, { loanFiles });
}

function dtiTable() {
  return screen.getByRole('table', { name: 'Debt-to-income breakdown at the offered and stressed rates' });
}

// The cells of the DTI table row whose label starts with the given text: [label, offered, stressed]
// or [label, both rates].
function dtiRow(label: string) {
  const header = within(dtiTable()).getByRole('rowheader', { name: new RegExp(`^${label}`) });
  return [...header.closest('tr')!.children] as HTMLElement[];
}

// The value of a fact in a named section, by its label (the unit after a comma is ignored).
function fact(section: string, label: string) {
  const region = screen.getByRole('region', { name: section });
  const term = within(region)
    .getAllByRole('term')
    .find((candidate) => candidate.textContent === label || candidate.textContent?.startsWith(`${label},`));

  if (!term) {
    throw new Error(`No fact "${label}" in ${section}`);
  }

  return term.nextElementSibling as HTMLElement;
}

afterEach(cleanup);

describe('loan file minting', () => {
  const storedNote = {
    tokenId: '27', txHash: '0xMintTransaction', contractAddress: '0xContract', auditHash: 'AuditHash',
    network: 'localhost', mintedAt: Timestamp.fromDate(new Date('2026-10-01T12:00:00Z')),
  };
  const approval: DecisionResult = { id: 'LN-1001', status: 'Underwriter Approved', decision: { outcome: 'approved' } };

  function setup(status = 'AI Deliberated', role: 'underwriter' | 'broker' = 'underwriter') {
    const loanFiles = new FakeLoanFileService({ 'LN-1001': loanFile('LN-1001', { ...seededApplication, status }) });
    const signOff = vi.fn<DecisionService['signOff']>().mockResolvedValue(approval);
    let resolveMint!: (result: SettlementResult) => void;
    const mint = vi.fn<SettlementService['mint']>(() => new Promise((resolve) => { resolveMint = resolve; }));
    const view = renderAs(`${role}-1`, role, `/${role}/applications/LN-1001`, {
      loanFiles, decisions: { signOff }, settlement: { mint },
    });
    return {
      ...view, loanFiles, signOff, mint,
      finishMint: () => act(async () => resolveMint({ id: 'LN-1001', status: 'Funded' })),
      push: (data: Record<string, unknown>) => act(() => loanFiles.push(loanFile('LN-1001', { ...seededApplication, ...data }))),
    };
  }

  async function decide(outcome: 'Approve' | 'Decline' = 'Approve') {
    const reason = await screen.findByRole('textbox', { name: /Justification/ });
    fireEvent.change(reason, { target: { value: 'Reviewed.' } });
    fireEvent.click(screen.getByRole('button', { name: outcome }));
    fireEvent.click(screen.getByRole('button', { name: outcome === 'Approve' ? 'Confirm approval' : 'Confirm decline' }));
  }

  it('automatically mints once after approval and waits for the listener before showing Funded or a note', async () => {
    const { mint, push, finishMint } = setup();
    await decide();
    expect(await screen.findByText('Minting…')).toHaveAttribute('role', 'status');
    expect(screen.getByText('Minting…')).toHaveAttribute('aria-live', 'polite');
    expect(mint).toHaveBeenCalledExactlyOnceWith('LN-1001');
    push({ status: 'Underwriter Approved', decision: { outcome: 'approved' } });
    const button = screen.getByRole('button', { name: 'Mint loan note' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await finishMint();
    expect(screen.getByText('Loan note minted. Waiting for the loan file to update…')).toBeInTheDocument();
    expect(screen.queryByText('Minting…')).not.toBeInTheDocument();
    expect(screen.getByText('Underwriter Approved', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Funded', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Loan note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mint/i })).not.toBeInTheDocument();
    push({ status: 'Funded', loanNote: storedNote, auditTxHash: '0xAuditTransaction' });
    expect(screen.getByText('Funded', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Loan note' })).toHaveTextContent(storedNote.txHash);
    expect(screen.queryByText(/Waiting for the loan file/)).not.toBeInTheDocument();
    expect(mint).toHaveBeenCalledOnce();
  });

  it('keeps a listener-confirmed note when the mint response arrives later', async () => {
    const { mint, push, finishMint } = setup();
    await decide();
    await screen.findByText('Minting…');
    push({ status: 'Funded', loanNote: storedNote });
    await finishMint();
    expect(screen.getByText('Funded', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Loan note' })).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the loan file/)).not.toBeInTheDocument();
    expect(mint).toHaveBeenCalledOnce();
  });

  it('never mints a decline', async () => {
    const { mint, signOff, push } = setup();
    signOff.mockResolvedValue({ id: 'LN-1001', status: 'Declined', decision: { outcome: 'declined' } });
    await decide('Decline');
    await screen.findByText(/Decision recorded: Declined/);
    push({ status: 'Declined', decision: { outcome: 'declined' } });
    expect(mint).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /mint/i })).not.toBeInTheDocument();
  });

  it('shows a 502 detail, leaves approval intact and sends only one retry on a double click', async () => {
    const { mint, push, finishMint } = setup();
    mint.mockRejectedValueOnce(new ApiError('http', 'The chain refused the mint.', 502));
    await decide();
    expect(await screen.findByRole('alert')).toHaveTextContent('The chain refused the mint.');
    push({ status: 'Underwriter Approved' });
    expect(screen.getByText('Underwriter Approved', { exact: true })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry mint' });
    act(() => { fireEvent.click(retry); fireEvent.click(retry); });
    expect(mint).toHaveBeenCalledTimes(2);
    expect(mint.mock.calls).toEqual([['LN-1001'], ['LN-1001']]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Minting…')).toBeInTheDocument();
    await finishMint();
  });

  it.each([
    [new ApiError('http', 'Missing rate.', 409), 'Missing rate.'],
    [new ApiError('http', 'No chain settings.', 503), 'No chain settings.'],
    [new ApiError('http', 'Unauthorized', 401), 'You are not allowed to mint this loan note.'],
    [new ApiError('http', 'Forbidden', 403), 'You are not allowed to mint this loan note.'],
    [new ApiError('network', 'offline'), 'Could not reach the server. Check your connection and try again.'],
  ])('shows the mapped mint error %s', async (error, message) => {
    const { mint } = setup('Underwriter Approved');
    mint.mockRejectedValueOnce(error);
    fireEvent.click(await screen.findByRole('button', { name: 'Mint loan note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Retry mint' })).toBeEnabled();
  });

  it('offers an explicit mint after refresh and locks two synchronous clicks', async () => {
    const { mint, finishMint } = setup('Underwriter Approved');
    const button = await screen.findByRole('button', { name: 'Mint loan note' });
    expect(mint).not.toHaveBeenCalled();
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(mint).toHaveBeenCalledExactlyOnceWith('LN-1001');
    expect(button).toBeDisabled();
    await finishMint();
  });

  it('does not offer mint or retry to a broker on a refreshed approval', async () => {
    const { mint } = setup('Underwriter Approved', 'broker');
    await screen.findByRole('region', { name: 'Borrower' });
    expect(screen.queryByRole('button', { name: /mint/i })).not.toBeInTheDocument();
    expect(mint).not.toHaveBeenCalled();
  });

  it.each(['Draft', 'Applied', 'AI Deliberated', 'Declined', 'Funded', 'Closed'])('does not offer manual mint on %s', async (status) => {
    const { mint } = setup(status);
    await screen.findByRole('region', { name: 'Borrower' });
    expect(screen.queryByRole('button', { name: /mint/i })).not.toBeInTheDocument();
    expect(mint).not.toHaveBeenCalled();
  });

  it.each(['Funded', 'Closed'])('shows a broker the loan note on a %s file', async (status) => {
    const { push, mint } = setup(status, 'broker');
    await screen.findByRole('region', { name: 'Borrower' });
    push({ status, loanNote: storedNote });
    expect(screen.getByRole('region', { name: 'Loan note' })).toHaveTextContent(storedNote.tokenId);
    expect(screen.queryByRole('button', { name: /mint/i })).not.toBeInTheDocument();
    expect(mint).not.toHaveBeenCalled();
  });

  it.each(['underwriter', 'broker'] as const)('offers the audit pack downloads to the %s once the note is stored', async (role) => {
    const { push } = setup('Underwriter Approved', role);
    await screen.findByRole('region', { name: 'Borrower' });
    expect(screen.queryByRole('region', { name: 'Audit pack' })).not.toBeInTheDocument();

    push({ status: 'Funded', loanNote: storedNote });
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
  });

  it.each(['AI Deliberated', 'Declined'])('offers no audit pack on %s', async (status) => {
    setup(status);
    await screen.findByRole('region', { name: 'Borrower' });
    expect(screen.queryByRole('region', { name: 'Audit pack' })).not.toBeInTheDocument();
  });

  it('does not start a mint when an approval resolves after leaving the file', async () => {
    const { mint, signOff, unmount } = setup();
    let resolve!: (result: DecisionResult) => void;
    signOff.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await decide();
    unmount();
    await act(async () => resolve(approval));
    expect(mint).not.toHaveBeenCalled();
  });
});

describe('loan file page', () => {
  it('offers sign-off to an underwriter on an AI Deliberated application', async () => {
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile() }));
    expect(await screen.findByRole('region', { name: 'Sign off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
  });

  it.each(['Draft', 'Applied', 'Underwriter Approved', 'Declined', 'Funded', 'Closed', 'Unknown'])(
    'does not offer sign-off to an underwriter on status %s', async (status) => {
      renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile('LN-1001', { ...seededApplication, status }) }));
      await screen.findByRole('region', { name: 'Borrower' });
      expect(screen.queryByRole('region', { name: 'Sign off' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    },
  );

  it('does not offer sign-off to a broker on an AI Deliberated file', async () => {
    renderAs('broker-1', 'broker', '/broker/applications/LN-1001', {
      loanFiles: new FakeLoanFileService({ 'LN-1001': loanFile() }),
    });
    await screen.findByRole('region', { name: 'Borrower' });
    expect(screen.queryByRole('region', { name: 'Sign off' })).not.toBeInTheDocument();
  });

  it.each(['response first', 'listener first'])('preserves the receipt and lets only Firestore update the badge (%s)', async (order) => {
    const user = userEvent.setup();
    const loanFiles = new FakeLoanFileService({ 'LN-1001': loanFile() });
    let resolve!: (value: DecisionResult) => void;
    const signOff = vi.fn<DecisionService['signOff']>(() => new Promise((done) => { resolve = done; }));
    renderAs('underwriter-1', 'underwriter', '/underwriter/applications/LN-1001', { loanFiles, decisions: { signOff } });
    await screen.findByRole('region', { name: 'Sign off' });
    await user.type(screen.getByRole('textbox', { name: /Justification/ }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(screen.getByText('AI Deliberated')).toBeInTheDocument();
    expect(screen.queryByText('Underwriter Approved', { exact: true })).not.toBeInTheDocument();

    const liveUpdate = () => act(() => loanFiles.push(loanFile('LN-1001', {
      ...seededApplication, status: 'Underwriter Approved', decision: { outcome: 'approved' },
    })));
    if (order === 'listener first') {
      liveUpdate();
      expect(screen.queryByRole('region', { name: 'Sign off' })).not.toBeInTheDocument();
    }
    await act(async () => resolve({ id: 'LN-1001', status: 'Underwriter Approved', decision: { outcome: 'approved' } }));
    expect(screen.getByText(/Decision recorded: Approved/)).toBeInTheDocument();
    if (order === 'response first') {
      expect(screen.getByText('AI Deliberated')).toBeInTheDocument();
      expect(screen.queryByText('Underwriter Approved', { exact: true })).not.toBeInTheDocument();
      liveUpdate();
    }
    expect(screen.getByText('Underwriter Approved', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Decision recorded: Approved/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sign off' })).not.toBeInTheDocument();
    expect(signOff).toHaveBeenCalledExactlyOnceWith('LN-1001', 'approved', 'Reviewed.');
  });

  it.each(['broker', 'underwriter'] as const)('renders the committee section for a %s', async (role) => {
    renderAs(`${role}-1`, role, `/${role}/applications/LN-1001`, {
      loanFiles: new FakeLoanFileService({ 'LN-1001': loanFile() }),
    });
    const committee = await screen.findByRole('region', { name: 'Committee' });
    expect(await within(committee).findByText('No committee run stored yet.')).toBeInTheDocument();
  });
  it.each([
    [100000, 62.5, false],
    [170000, 80, false],
    [180000, 82.5, true],
  ])('shows the stored HELOC limit %s and combined LTV %s', async (loanAmountEur, ltvPct, above) => {
    renderUnderwriterFile(new FakeLoanFileService({
      'LN-1001': loanFile('LN-1001', {
        ...seededApplication, loanType: 'heloc', estimatedValueEur: 400000,
        existingMortgageBalanceEur: 150000, loanAmountEur, ltvPct,
      }),
    }));
    const collateral = await screen.findByRole('region', { name: 'Collateral (HELOC)' });
    expect(screen.getByText('HELOC')).toBeInTheDocument();
    expect(within(collateral).getByText('indicative estimate of a 2024 asking price, not a valuation')).toBeInTheDocument();
    expect(within(collateral).getByText('€400,000')).toBeInTheDocument();
    expect(fact('Collateral (HELOC)', 'Existing mortgage balance')).toHaveTextContent('€150,000');
    expect(fact('Collateral (HELOC)', 'Credit limit requested')).toHaveTextContent(
      new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(loanAmountEur),
    );
    expect(fact('Collateral (HELOC)', 'Combined LTV')).toHaveTextContent(`${ltvPct}%`);
    expect(fact('Collateral (HELOC)', 'Combined LTV cap')).toHaveTextContent('80%');
    expect(within(collateral).getByText(`Combined LTV ${ltvPct}% against the 80% cap`)).toBeInTheDocument();
    expect(collateral.querySelector('[aria-hidden="true"]')).toHaveTextContent('80% cap');
    expect(Boolean(within(collateral).queryByText('Above the 80% combined LTV cap'))).toBe(above);
    expect(fact('Loan', 'Combined LTV')).toHaveTextContent(`${ltvPct}%`);
    expect(screen.getByRole('region', { name: 'Loan' })).not.toHaveTextContent(/asking price|Stored LTV band/i);
    expect(within(screen.getByRole('region', { name: 'Property' })).queryByText('Asking price')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).not.toHaveTextContent(/deposit|price[- ]gap|requires lender exception review/i);
  });

  it('passes the stored review gate to the HELOC collateral section', async () => {
    const conditions = [
      'Requires lender exception review (CLTV_CAP)',
      "Requires an independent surveyor's valuation (HELOC)",
    ];
    renderUnderwriterFile(new FakeLoanFileService({
      'LN-1001': loanFile('LN-1001', {
        ...seededApplication, loanType: 'heloc', ltvPct: 82.5,
      }, toLoanFileReview({
        ...seededReview,
        policyGate: { original: 'Approve', effective: 'Conditionally Approve', breaches: ['CLTV_CAP'], conditions },
      })),
    }));
    const collateral = await screen.findByRole('region', { name: 'Collateral (HELOC)' });
    expect(within(collateral).getByText(
      'Requires lender exception review: the combined LTV is above the 80% cap (CLTV_CAP).',
    )).toBeInTheDocument();
    expect(within(collateral).getAllByRole('listitem').map((item) => item.textContent)).toEqual(conditions);
  });

  it.each([null, 310000])('omits the HELOC asking price row when the stored price is %s', async (askingPriceEur) => {
    renderUnderwriterFile(new FakeLoanFileService({
      'LN-1001': loanFile('LN-1001', {
        ...seededApplication, loanType: 'heloc', property: { ...seededApplication.property, askingPriceEur },
      }, { state: 'absent' }),
    }));
    const property = await screen.findByRole('region', { name: 'Property' });
    expect(within(property).queryByText('Asking price')).not.toBeInTheDocument();
    const collateral = screen.getByRole('region', { name: 'Collateral (HELOC)' });
    expect(collateral).toHaveTextContent('The policy check is not stored with this application yet.');
    expect(collateral).not.toHaveTextContent('surveyor');
  });

  it.each([
    { estimatedValueEur: null, ltvPct: 62.5 },
    { estimatedValueEur: 400000, ltvPct: null },
    { estimatedValueEur: null, ltvPct: null },
  ])('shows missing HELOC figures as Unavailable: %j', async (figures) => {
    renderUnderwriterFile(new FakeLoanFileService({
      'LN-1001': loanFile('LN-1001', { ...seededApplication, loanType: 'heloc', ...figures, loanAmountEur: null }),
    }));
    const collateral = await screen.findByRole('region', { name: 'Collateral (HELOC)' });
    const estimate = within(collateral).getByText('Estimated value').closest('dt')!.nextElementSibling;
    expect(estimate).toHaveTextContent(figures.estimatedValueEur === null ? 'Unavailable' : '€400,000');
    expect(fact('Collateral (HELOC)', 'Combined LTV')).toHaveTextContent(figures.ltvPct === null ? 'Unavailable' : '62.5%');
    expect(fact('Collateral (HELOC)', 'Existing mortgage balance')).toHaveTextContent('Unavailable');
    expect(fact('Collateral (HELOC)', 'Credit limit requested')).toHaveTextContent('Unavailable');
    expect(collateral).not.toHaveTextContent(/€0|Above the 80%/);
    if (figures.ltvPct === null) {
      expect(collateral.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(within(collateral).queryByText(/against the 80% cap/)).not.toBeInTheDocument();
    }
  });

  it('uses the stored combined LTV even when the other stored figures would imply a different value', async () => {
    renderUnderwriterFile(new FakeLoanFileService({
      'LN-1001': loanFile('LN-1001', {
        ...seededApplication, loanType: 'heloc', estimatedValueEur: 400000,
        existingMortgageBalanceEur: 150000, loanAmountEur: 100000, ltvPct: 82.5,
      }),
    }));
    const collateral = await screen.findByRole('region', { name: 'Collateral (HELOC)' });
    expect(fact('Collateral (HELOC)', 'Combined LTV')).toHaveTextContent('82.5%');
    expect(collateral).toHaveTextContent('Above the 80% combined LTV cap');
    expect(collateral).not.toHaveTextContent('62.5%');
  });

  it.each(['mortgage', null])('keeps the collateral placeholder and header for loan type %s', async (loanType) => {
    renderUnderwriterFile(new FakeLoanFileService({
      'LN-1001': loanFile('LN-1001', { ...seededApplication, loanType }),
    }));
    const collateral = await screen.findByRole('region', { name: 'Collateral' });
    expect(collateral).toHaveTextContent('The collateral record for this property is not shown on the loan file yet.');
    expect(screen.queryByRole('region', { name: 'Collateral (HELOC)' })).not.toBeInTheDocument();
    expect(screen.getByText(loanType === 'mortgage' ? 'Mortgage' : 'Loan type unavailable')).toBeInTheDocument();
  });

  it('shows each DTI figure from the application and its review', async () => {
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile() }));
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(dtiRow('Interest rate')[1]).toHaveTextContent('4%');
    expect(dtiRow('Gross income')[1]).toHaveTextContent('€6,250');
    expect(dtiRow('Existing debt repayments')[1]).toHaveTextContent('€300');
    expect(dtiRow('New loan repayment')[1]).toHaveTextContent('€1,265');
    expect(dtiRow('Debt to income')[1]).toHaveTextContent('33.4%');
  });

  it('labels monthly and yearly figures', async () => {
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile() }));
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(dtiRow('Gross income')[0]).toHaveTextContent('per month, before tax');
    expect(dtiRow('New loan repayment')[0]).toHaveTextContent('per month');
    expect(dtiRow('Debt to income')[0]).toHaveTextContent('of gross monthly income');
    expect(fact('Borrower', 'Gross income').previousElementSibling).toHaveTextContent('Gross income, per year');
    expect(fact('Borrower', 'Gross income')).toHaveTextContent('€75,000');
    expect(fact('Borrower', 'Existing debt repayments').previousElementSibling).toHaveTextContent('per month');
  });

  it('labels the stressed column with the stress margin and shows unstored stressed figures as Unavailable', async () => {
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile() }));
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(within(dtiTable()).getByRole('columnheader', { name: 'Stressed (+2 points)' })).toBeInTheDocument();
    for (const label of ['Interest rate', 'New loan repayment', 'Debt to income', 'Surplus after']) {
      expect(dtiRow(label)[2]).toHaveTextContent(/^Unavailable$/);
    }
    expect(dtiRow('Surplus after')[1]).toHaveTextContent(/^Unavailable$/);
    for (const label of ['Take-home pay', 'Living costs', 'DTI band', 'Surplus band']) {
      expect(dtiRow(label)[1]).toHaveTextContent(/^Unavailable/);
    }
    expect(screen.getByText('Benchmark rate').nextElementSibling).toHaveTextContent('Unavailable');
    expect(screen.getByText('Benchmark rate from').nextElementSibling).toHaveTextContent('Unavailable');
    expect(screen.getByText('Stress margin').nextElementSibling).toHaveTextContent('+2 points');
    expect(screen.getByText(/Stressed figures, surpluses and bands are not stored/)).toBeInTheDocument();
  });

  // The breakdown al-core seeds for app-funded (al-core SCHEMA.md, dtiBreakdown), every figure stored.
  it('shows every stored breakdown figure at both rates, with one band each', async () => {
    const review = toLoanFileReview({
      riskTier: 'A',
      dtiBreakdown: {
        incomeMonthlyEur: 7333.33,
        takeHomeMonthlyEur: 4900,
        existingDebtsMonthlyEur: 200,
        livingCostsMonthlyEur: 1800,
        newRepaymentMonthlyEur: 1384.5,
        stressedRepaymentMonthlyEur: 1738.7,
        benchmarkRatePct: 4,
        stressMarginPct: 2,
        stressedRatePct: 6,
        rateDate: '2026-09',
        dtiPct: 21.61,
        stressedDtiPct: 26.44,
        surplusMonthlyEur: 1515.5,
        stressedSurplusMonthlyEur: -150,
        dtiBand: 'Comfortable',
        surplusBand: 'Adverse',
      },
    });
    const application = { ...seededApplication, dtiPct: 21.6 };
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile('LN-1001', application, review) }));
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(within(dtiTable()).getByRole('columnheader', { name: 'Stressed (+2 points)' })).toBeInTheDocument();
    expect(dtiRow('Interest rate')[2]).toHaveTextContent('6%');
    expect(dtiRow('Gross income')[1]).toHaveTextContent('€7,333');
    expect(dtiRow('Take-home pay')[1]).toHaveTextContent('€4,900');
    expect(dtiRow('Take-home pay')[0]).toHaveTextContent('per month, after tax');
    expect(dtiRow('Existing debt repayments')[1]).toHaveTextContent('€200');
    expect(dtiRow('Living costs')[1]).toHaveTextContent('€1,800');
    expect(dtiRow('New loan repayment')[1]).toHaveTextContent('€1,385');
    expect(dtiRow('New loan repayment')[2]).toHaveTextContent('€1,739');
    expect(dtiRow('Debt to income')[1]).toHaveTextContent('21.6%');
    expect(dtiRow('Debt to income')[2]).toHaveTextContent('26.4%');
    expect(dtiRow('Surplus after')[1]).toHaveTextContent('€1,516');
    expect(dtiRow('Surplus after')[2]).toHaveTextContent('-€150');
    // One band each, set on the stressed figures, so the row spans both columns.
    expect(dtiRow('DTI band')).toHaveLength(2);
    expect(dtiRow('DTI band')[1]).toHaveTextContent('Comfortable');
    expect(dtiRow('DTI band')[1]).toHaveTextContent('Set on the stressed figures');
    expect(dtiRow('Surplus band')[1]).toHaveTextContent('Adverse');
    expect(screen.getByText('Benchmark rate').nextElementSibling).toHaveTextContent('4%');
    expect(screen.getByText('Benchmark rate from').nextElementSibling).toHaveTextContent('September 2026');
    expect(screen.getByText('Stress margin').nextElementSibling).toHaveTextContent('+2 points');
    expect(within(screen.getByRole('region', { name: 'Debt to income' })).queryByText(/not stored with this application yet/)).not.toBeInTheDocument();
    expect(screen.queryByText('agreed default, not yet stored')).not.toBeInTheDocument();
  });

  it('labels the stressed column with a stored margin other than 2 points', async () => {
    const review = toLoanFileReview({ ...seededReview, dtiBreakdown: { ...seededReview.dtiBreakdown, stressMarginPct: 3 } });
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile('LN-1001', seededApplication, review) }));
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(within(dtiTable()).getByRole('columnheader', { name: 'Stressed (+3 points)' })).toBeInTheDocument();
  });

  it('shows the borrower, the loan and the property', async () => {
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile() }));
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(fact('Loan', 'Amount requested')).toHaveTextContent('€265,000');
    expect(fact('Loan', 'Term')).toHaveTextContent('30 years');
    expect(fact('Loan', 'Valuation LTV')).toHaveTextContent('86.6%');
    expect(fact('Loan', 'Stored LTV band')).toHaveTextContent('>80% to 90%');
    expect(fact('Loan', 'Risk tier')).toHaveTextContent('B');
    expect(fact('Loan', 'Decision')).toHaveTextContent('Not decided yet');
    expect(fact('Property', 'County')).toHaveTextContent('Cork');
    expect(fact('Property', 'Property type')).toHaveTextContent('Semi-D');
    expect(fact('Property', 'Bedrooms')).toHaveTextContent('3');
    expect(fact('Property', 'Floor area')).toHaveTextContent('98 m²');
    expect(fact('Property', 'BER rating')).toHaveTextContent('C2');
    expect(fact('Property', 'Asking price')).toHaveTextContent('€310,000');
    expect(screen.getByText('AI Deliberated')).toBeInTheDocument();
  });

  it('shows the stored valuation breakdown and keeps collateral as a placeholder', async () => {
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile() }));
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    const collateral = screen.getByRole('region', { name: 'Collateral' });
    expect(within(collateral).getByRole('heading', { name: 'Collateral' })).toBeInTheDocument();
    expect(collateral).not.toHaveTextContent(/€|\d/);

    const valuation = screen.getByRole('region', { name: 'Valuation' });
    expect(within(valuation).getByText('How each detail moved the estimate')).toBeInTheDocument();
    expect(within(valuation).getByText('€250,000')).toBeInTheDocument();
    expect(within(valuation).getByText('€310,000')).toBeInTheDocument();
    const rows = within(valuation).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Floor area98 m²+€31,200');
    expect(rows[1]).toHaveTextContent('CountyCork+€18,500');
    expect(rows).toHaveLength(6);
    expect(rows[2]).toHaveTextContent('Bedrooms3+€9,800');
    expect(rows[3]).toHaveTextContent('Eircode areaT12+€6,400');
    expect(rows[4]).toHaveTextContent('Property typeSemi-D−€4,600');
    expect(rows[5]).toHaveTextContent('BER ratingC2−€1,300');
  });

  it('keeps the valuation estimate and support warnings when the stored breakdown failed', async () => {
    const review = toLoanFileReview({ ...seededReview, valuationDetail: {
      ...seededReview.valuationDetail,
      baselineEur: null,
      contributions: null,
      supportWarnings: ['Few comparable homes.', 'Unseen Eircode area.'],
    } });
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile('LN-1001', seededApplication, review) }));
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    const valuation = screen.getByRole('region', { name: 'Valuation' });
    expect(within(valuation).getByText('€310,000')).toBeInTheDocument();
    expect(within(valuation).getByText("The breakdown of this estimate isn't available.")).toBeInTheDocument();
    expect(within(valuation).queryByRole('list', { name: 'Valuation contributions' })).not.toBeInTheDocument();
    expect(within(valuation).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Few comparable homes.', 'Unseen Eircode area.']);
  });

  it('shows Unavailable for every missing figure, never 0 or a dash', async () => {
    renderUnderwriterFile(
      new FakeLoanFileService({ 'LN-1002': loanFile('LN-1002', { status: 'Applied' }, { state: 'absent' }) }),
      'LN-1002',
    );
    await screen.findByRole('heading', { level: 1, name: 'Borrower name unavailable' });

    for (const label of ['Gross income', 'Existing debt repayments', 'Take-home pay', 'Living costs', 'Applicants']) {
      expect(fact('Borrower', label)).toHaveTextContent(/^Unavailable$/);
    }
    for (const label of ['Amount requested', 'Term', 'Offered rate', 'Valuation LTV', 'Stored LTV band', 'Risk tier']) {
      expect(fact('Loan', label)).toHaveTextContent(/^Unavailable$/);
    }
    for (const label of ['County', 'Bedrooms', 'Floor area', 'Asking price']) {
      expect(fact('Property', label)).toHaveTextContent(/^Unavailable$/);
    }
    for (const label of ['Gross income', 'Existing debt repayments']) {
      expect(dtiRow(label)[1]).toHaveTextContent(/^Unavailable/);
    }
    expect(dtiRow('New loan repayment')[1]).toHaveTextContent(/^Unavailable$/);
    expect(dtiRow('Debt to income')[1]).toHaveTextContent(/^Unavailable$/);
    expect(screen.getByRole('main')).not.toHaveTextContent(/€0|(^|\s)0%|—/);
    expect(screen.getByText(/underwriting review has not been written yet/)).toBeInTheDocument();
  });

  it('keeps a real zero', async () => {
    renderUnderwriterFile(
      new FakeLoanFileService({
        'LN-1003': loanFile('LN-1003', { ...seededApplication, monthlyDebtsEur: 0, property: { bedrooms: 0 } }),
      }),
      'LN-1003',
    );
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(fact('Borrower', 'Existing debt repayments')).toHaveTextContent('€0');
    expect(fact('Property', 'Bedrooms')).toHaveTextContent(/^0$/);
  });

  it('says the review is loading, then fills its figures in without a reload', async () => {
    const loanFiles = new FakeLoanFileService({ 'LN-1001': loanFile('LN-1001', seededApplication, { state: 'pending' }) });
    renderUnderwriterFile(loanFiles);
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(screen.getByText('Loading the underwriting review.')).toBeInTheDocument();
    expect(dtiRow('New loan repayment')[1]).toHaveTextContent('Loading');
    expect(dtiRow('Debt to income')[1]).toHaveTextContent('33.4%');

    act(() => loanFiles.push(loanFile()));
    expect(screen.queryByText('Loading the underwriting review.')).not.toBeInTheDocument();
    expect(dtiRow('New loan repayment')[1]).toHaveTextContent('€1,265');
    expect(loanFiles.subscriptions).toHaveLength(1);
  });

  it('says so when the review cannot be read', async () => {
    renderUnderwriterFile(
      new FakeLoanFileService({ 'LN-1001': loanFile('LN-1001', seededApplication, { state: 'unavailable' }) }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(screen.getByText(/underwriting review could not be read/)).toBeInTheDocument();
    expect(dtiRow('New loan repayment')[1]).toHaveTextContent(/^Unavailable$/);
    expect(dtiRow('Debt to income')[1]).toHaveTextContent('33.4%');
  });

  it('shows a loading state before the first answer', async () => {
    renderUnderwriterFile(new FakeLoanFileService());

    expect(await screen.findByRole('heading', { name: 'Loading the loan file' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows not found for an application that does not exist', async () => {
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-404': { status: 'not-found' } }), 'LN-404');

    expect(await screen.findByRole('heading', { name: 'Application not found' })).toBeInTheDocument();
  });

  it('shows a refusal to an underwriter who is not allowed to read it', async () => {
    const loanFiles = new FakeLoanFileService();
    renderUnderwriterFile(loanFiles);
    await screen.findByRole('heading', { name: 'Loading the loan file' });
    act(() => loanFiles.fail('forbidden'));

    expect(screen.getByRole('heading', { name: 'You are not allowed to read this application' })).toBeInTheDocument();
  });

  it('says the file could not be loaded when the connection fails', async () => {
    const loanFiles = new FakeLoanFileService();
    renderUnderwriterFile(loanFiles);
    await screen.findByRole('heading', { name: 'Loading the loan file' });
    act(() => loanFiles.fail('unavailable'));

    expect(screen.getByRole('heading', { name: 'The loan file could not be loaded' })).toBeInTheDocument();
  });

  it('links an underwriter back to the pipeline', async () => {
    renderUnderwriterFile(new FakeLoanFileService({ 'LN-1001': loanFile() }));
    expect(await screen.findByRole('link', { name: 'Back to the pipeline' })).toHaveAttribute('href', '/underwriter/pipeline');
  });

  it('stops listening when the page is left', async () => {
    const loanFiles = new FakeLoanFileService({ 'LN-1001': loanFile() });
    renderUnderwriterFile(loanFiles);
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });
    await userEvent.setup().click(screen.getByRole('link', { name: 'Back to the pipeline' }));

    expect(loanFiles.active()).toHaveLength(0);
  });

  it('stops listening on unmount', async () => {
    const loanFiles = new FakeLoanFileService({ 'LN-1001': loanFile() });
    const { unmount } = renderUnderwriterFile(loanFiles);
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });
    unmount();

    expect(loanFiles.subscriptions).toHaveLength(1);
    expect(loanFiles.active()).toHaveLength(0);
  });

  it('replaces the listener when the application changes and ignores late answers for the old one', async () => {
    const loanFiles = new FakeLoanFileService({ 'LN-1001': loanFile() });
    renderUnderwriterFile(loanFiles);
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    act(() => navigateTo('/underwriter/applications/LN-2002'));
    expect(screen.getByRole('heading', { name: 'Loading the loan file' })).toBeInTheDocument();
    expect(loanFiles.subscriptions.map(({ applicationId, active }) => [applicationId, active])).toEqual([
      ['LN-1001', false],
      ['LN-2002', true],
    ]);

    act(() => loanFiles.subscriptions[0].listener(loanFile()));
    expect(screen.queryByRole('heading', { name: 'Alice Byrne' })).not.toBeInTheDocument();

    act(() => loanFiles.push(loanFile('LN-2002', { ...seededApplication, borrowerName: 'Brian Walsh' })));
    expect(screen.getByRole('heading', { level: 1, name: 'Brian Walsh' })).toBeInTheDocument();
  });
});

describe('broker loan file', () => {
  function renderBrokerFile(loanFiles: FakeLoanFileService, uid = 'broker-1') {
    return renderAs(uid, 'broker', '/broker/applications/LN-1001', { loanFiles });
  }

  it('shows a broker the same file for their own client, with no decision or stress controls', async () => {
    renderBrokerFile(new FakeLoanFileService({ 'LN-1001': loanFile() }));
    await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' });

    expect(dtiRow('Debt to income')[1]).toHaveTextContent('33.4%');
    expect(within(dtiTable()).getByRole('columnheader', { name: 'Stressed (+2 points)' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Valuation' })).getByText('+€31,200')).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).queryAllByRole('button')).toHaveLength(0);
    for (const role of ['textbox', 'spinbutton', 'combobox', 'radio', 'checkbox', 'slider'] as const) {
      expect(within(main).queryAllByRole(role)).toHaveLength(0);
    }
    expect(screen.queryByText(/approve|decline/i)).not.toBeInTheDocument();
  });

  it('links a broker back to the client file', async () => {
    renderBrokerFile(new FakeLoanFileService({ 'LN-1001': loanFile() }));
    expect(await screen.findByRole('link', { name: 'Back to the client file' })).toHaveAttribute(
      'href',
      '/broker/clients/borrower-1',
    );
  });

  it('does not show another broker\'s application even if it is answered', async () => {
    renderBrokerFile(new FakeLoanFileService({ 'LN-1001': loanFile() }), 'broker-2');

    expect(await screen.findByRole('heading', { name: 'Application not available' })).toBeInTheDocument();
    expect(screen.queryByText('Alice Byrne')).not.toBeInTheDocument();
  });

  it('says a refused application, such as a hidden Draft, is not available without saying which', async () => {
    const loanFiles = new FakeLoanFileService();
    renderBrokerFile(loanFiles);
    await screen.findByRole('heading', { name: 'Loading the loan file' });
    act(() => loanFiles.fail('forbidden'));

    expect(screen.getByRole('heading', { name: 'Application not available' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to my clients' })).toHaveAttribute('href', '/broker/clients');
  });

  it('refuses a broker on the underwriter route without subscribing', async () => {
    const loanFiles = new FakeLoanFileService({ 'LN-1001': loanFile() });
    renderAs('broker-1', 'broker', '/underwriter/applications/LN-1001', { loanFiles });

    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
    expect(loanFiles.subscriptions).toHaveLength(0);
  });

  it('refuses a borrower on both routes without subscribing', async () => {
    for (const path of ['/broker/applications/LN-1001', '/underwriter/applications/LN-1001']) {
      const loanFiles = new FakeLoanFileService({ 'LN-1001': loanFile() });
      renderAs('borrower-1', 'borrower', path, { loanFiles });

      expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
      expect(loanFiles.subscriptions).toHaveLength(0);
      cleanup();
    }
  });

  it('opens the loan file from an application on the client file', async () => {
    const applications = [toBrokerApplication('LN-1001', seededApplication)].filter(
      (application): application is BrokerApplication => application !== null,
    );
    const clients: ClientsService = {
      subscribeToBrokerClients(_uid, listener) {
        listener({ clients: buildBrokerClients([], applications), profilesState: 'available' });
        return () => {};
      },
    };
    renderAs('broker-1', 'broker', '/broker/clients/borrower-1', {
      clients,
      loanFiles: new FakeLoanFileService({ 'LN-1001': loanFile() }),
    });

    await userEvent.setup().click(await screen.findByRole('link', { name: 'LN-1001' }));

    expect(currentPath).toBe('/broker/applications/LN-1001');
    expect(await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' })).toBeInTheDocument();
  });
});

describe('pipeline queue to loan file', () => {
  const pipeline: PipelineService = {
    subscribeToPipeline(listener) {
      listener({
        applications: withRiskTiers([toApplicationSummary('LN-1001', seededApplication)], new Map()),
        riskTierState: 'available',
        riskTierError: null,
      });
      return () => {};
    },
  };

  function renderQueue() {
    return renderAs('underwriter-1', 'underwriter', '/underwriter/pipeline', {
      pipeline,
      loanFiles: new FakeLoanFileService({ 'LN-1001': loanFile() }),
    });
  }

  it('links each row\'s application ID to its loan file', async () => {
    renderQueue();
    const link = await screen.findByRole('link', { name: 'LN-1001' });
    expect(link).toHaveAttribute('href', '/underwriter/applications/LN-1001');

    await userEvent.setup().click(link);
    expect(currentPath).toBe('/underwriter/applications/LN-1001');
    expect(await screen.findByRole('heading', { level: 1, name: 'Alice Byrne' })).toBeInTheDocument();
  });

  it('opens the loan file when the row is clicked', async () => {
    renderQueue();
    const row = (await screen.findByRole('rowheader', { name: 'LN-1001' })).closest('tr')!;
    await userEvent.setup().click(within(row).getByText('AI Deliberated'));

    expect(currentPath).toBe('/underwriter/applications/LN-1001');
  });

  it('encodes an application ID in the link', async () => {
    const odd: PipelineService = {
      subscribeToPipeline(listener) {
        listener({
          applications: withRiskTiers([toApplicationSummary('LN 1#2', { status: 'Applied' })], new Map()),
          riskTierState: 'available',
          riskTierError: null,
        });
        return () => {};
      },
    };
    renderAs('underwriter-1', 'underwriter', '/underwriter/pipeline', { pipeline: odd });

    expect(await screen.findByRole('link', { name: 'LN 1#2' })).toHaveAttribute(
      'href',
      '/underwriter/applications/LN%201%232',
    );
  });
});
