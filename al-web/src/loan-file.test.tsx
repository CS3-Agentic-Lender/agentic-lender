import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider } from './context/AuthContext';
import { ClientsServiceContext } from './context/BrokerClientsContext';
import { LoanFileServiceContext } from './context/LoanFileContext';
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
    contributions: { county: 18500, floor_area: 31200, ber: -1300 },
    estimatedValueEur: 298400,
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
  loanFiles?: LoanFileService;
  pipeline?: PipelineService;
  clients?: ClientsService;
}

function renderAs(uid: string, role: TrustedRole, pathname: string, services: Services) {
  return render(
    <AuthProvider service={new FakeAuthService(authUser(uid), role)}>
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

describe('loan file page', () => {
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
    expect(within(valuation).getByText('€298,400')).toBeInTheDocument();
    const rows = within(valuation).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Floor area98 m²+€31,200');
    expect(rows[1]).toHaveTextContent('CountyCork+€18,500');
    expect(rows[2]).toHaveTextContent('BER ratingC2−€1,300');
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
