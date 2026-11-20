import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './context/AuthContext';
import { StressServiceContext } from './context/StressContext';
import { AppRoutes } from './routes';
import { ApiError } from './services/apiClient';
import type { AuthService, AuthStateListener, AuthUser, TrustedRole } from './services/authService';
import type {
  AffordabilityBand,
  BandCounts,
  RateShockResult,
  ShockedApplication,
  StressService,
} from './services/stressService';

function authUser(uid: string): AuthUser {
  return {
    uid,
    email: `${uid}@example.test`,
    getIdToken: async () => 'id-token',
    getIdTokenResult: async () => ({ claims: {} }) as never,
  };
}

class FakeAuthService implements AuthService {
  constructor(private readonly role: TrustedRole) {}

  subscribe(listener: AuthStateListener) {
    listener(authUser(`${this.role}-1`));
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

interface Call {
  shockBps: number;
  resolve: (result: RateShockResult) => void;
  reject: (error: unknown) => void;
}

// Each call waits until the test answers it, so the test decides the order answers arrive in.
class FakeStressService implements StressService {
  readonly calls: Call[] = [];

  rateShock(shockBps: number) {
    return new Promise<RateShockResult>((resolve, reject) => {
      this.calls.push({ shockBps, resolve, reject });
    });
  }

  async called(shockBps: number) {
    await waitFor(() => expect(this.calls.map((call) => call.shockBps)).toContain(shockBps));
    return this.calls.filter((call) => call.shockBps === shockBps).at(-1)!;
  }

  async answer(shockBps: number, result: RateShockResult = sample(shockBps)) {
    const call = await this.called(shockBps);
    await act(async () => call.resolve(result));
  }

  async fail(shockBps: number, error: unknown) {
    const call = await this.called(shockBps);
    await act(async () => call.reject(error));
  }
}

function figures(band: AffordabilityBand, repaymentEur: number, dtiPct: number, surplusEur: number) {
  return { band, repaymentEur, dtiPct, surplusEur };
}

function application(
  applicationId: string,
  before: AffordabilityBand,
  after: AffordabilityBand,
  afterDtiPct: number,
  rateSource: ShockedApplication['rateSource'] = 'stored',
): ShockedApplication {
  return {
    applicationId,
    rateSource,
    benchmarkRatePct: 4,
    shockedRatePct: 6,
    before: figures(before, 1432.25, 33.5, 1367.75),
    after: figures(after, 1798.65, afterDtiPct, 401.35),
    movedInto: before === after ? null : (after as 'Caution' | 'Adverse'),
  };
}

function counts(comfortable: number, caution: number, adverse: number): BandCounts {
  const total = comfortable + caution + adverse;
  const share = (count: number) => (total ? Math.round((1000 * count) / total) / 10 : 0);
  return {
    Comfortable: { count: comfortable, sharePct: share(comfortable) },
    Caution: { count: caution, sharePct: share(caution) },
    Adverse: { count: adverse, sharePct: share(adverse) },
  };
}

// Four applications: two get worse at the shock, one stays Comfortable, one was already Adverse.
function sample(shockBps: number): RateShockResult {
  return {
    shockBps,
    applications: [
      application('app-steady', 'Comfortable', 'Comfortable', 30.1),
      application('app-caution', 'Comfortable', 'Caution', 44.2),
      application('app-adverse', 'Caution', 'Adverse', 52.7, 'current'),
      application('app-already', 'Adverse', 'Adverse', 61.0),
    ],
    totals: {
      count: 4,
      before: counts(2, 1, 1),
      after: counts(1, 1, 2),
      movedIntoCaution: 1,
      movedIntoAdverse: 1,
    },
    skipped: [{ applicationId: 'app-broken', reason: 'a figure on the application is not a number' }],
  };
}

function renderStress(stress: StressService, role: TrustedRole = 'underwriter', path = '/underwriter/stress') {
  return render(
    <AuthProvider service={new FakeAuthService(role)}>
      <StressServiceContext.Provider value={stress}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </StressServiceContext.Provider>
    </AuthProvider>,
  );
}

function band(name: string) {
  return screen.getByRole('listitem', { name });
}

// A metric card: its big value and the line under it.
function metric(label: string) {
  const value = screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;
  return { value: value.firstElementChild?.textContent, detail: value.lastElementChild?.textContent };
}

afterEach(cleanup);

describe('the rate shock page', () => {
  it('runs +200 bps on opening and draws the band counts from the result', async () => {
    const stress = new FakeStressService();
    renderStress(stress);

    expect(await screen.findByRole('heading', { name: 'Calculating the rate shock' })).toBeInTheDocument();
    await stress.answer(200);

    expect(stress.calls.map((call) => call.shockBps)).toEqual([200]);
    expect(screen.getByRole('status')).toHaveTextContent('Showing +200 bps.');
    expect(band('Comfortable')).toHaveTextContent(/Before\s*2 2 applications,\s*50%/);
    expect(band('Comfortable')).toHaveTextContent(/After\s*1 1 application,\s*25%/);
    expect(band('Adverse')).toHaveTextContent(/After\s*2 2 applications,\s*50%/);
    expect(metric('Applications measured')).toEqual({
      value: '4',
      detail: "3 at the committee run's benchmark rate, 1 at today's ECB rate",
    });
    expect(metric('Rate rise').value).toBe('+2 points');
  });

  it('lists only the applications that move to a worse band, worst first, each linking to its loan file', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    const table = screen.getByRole('table', { name: /move to a worse affordability band at \+2 points/ });
    const rows = within(table).getAllByRole('row').slice(1);

    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['app-adverse', 'app-caution']);
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/underwriter/applications/app-adverse');
    expect(rows[0]).toHaveTextContent(/4\.00%\W*to 6\.00%/);
    expect(rows[0]).toHaveTextContent("Today's ECB rate: no committee run yet");
    expect(rows[0]).toHaveTextContent(/33\.5%\W*to 52\.7%/);
    expect(rows[0]).toHaveTextContent(/Caution\W*to Adverse/);
    expect(rows[1]).toHaveTextContent(/Comfortable\W*to Caution/);
    expect(metric('Moved to a worse band')).toEqual({ value: '2', detail: '1 into Caution, 1 into Adverse' });
  });

  it('lists the applications al-ai could not measure, with the reason', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    const skipped = screen.getByRole('region', { name: 'Not measured' });
    expect(within(skipped).getByRole('link', { name: 'app-broken' })).toHaveAttribute(
      'href',
      '/underwriter/applications/app-broken',
    );
    expect(skipped).toHaveTextContent('a figure on the application is not a number');
  });

  it('redraws for a new slider position, and an older answer arriving late never replaces a newer one', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);
    const slider = screen.getByRole('slider', { name: 'Rate rise' });

    fireEvent.change(slider, { target: { value: '250' } });
    await stress.called(250);
    fireEvent.change(slider, { target: { value: '300' } });
    await stress.called(300);

    const atThreeHundred = sample(300);
    atThreeHundred.totals.after = counts(0, 1, 3);
    await stress.answer(300, atThreeHundred);
    expect(band('Adverse')).toHaveTextContent(/After\s*3 3 applications/);

    // The +250 answer comes back last: the page keeps showing +300.
    await stress.answer(250);
    expect(band('Adverse')).toHaveTextContent(/After\s*3 3 applications/);
    expect(screen.getByRole('status')).toHaveTextContent('Showing +300 bps.');
    expect(metric('Rate rise').value).toBe('+3 points');
  });

  it('sends one request after the slider stops, not one per step it passed', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);
    const slider = screen.getByRole('slider', { name: 'Rate rise' });

    vi.useFakeTimers();
    try {
      for (const value of ['225', '250', '275']) {
        fireEvent.change(slider, { target: { value } });
        await act(async () => vi.advanceTimersByTime(100));
      }
      expect(screen.getByRole('status')).toHaveTextContent('Showing +200 bps. +275 bps runs when the slider stops.');
      await act(async () => vi.advanceTimersByTime(300));
    } finally {
      vi.useRealTimers();
    }

    expect(stress.calls.map((call) => call.shockBps)).toEqual([200, 275]);
  });

  it('only offers the shocks al-ai accepts: +100 to +300 bps in steps of 25', async () => {
    renderStress(new FakeStressService());
    const slider = await screen.findByRole('slider', { name: 'Rate rise' });

    expect(slider).toHaveAttribute('min', '100');
    expect(slider).toHaveAttribute('max', '300');
    expect(slider).toHaveAttribute('step', '25');
    expect(slider).toHaveValue('200');
    expect(slider).toHaveAttribute('aria-valuetext', '+200 bps, +2 points');
  });

  it('keeps the last result on screen and says so when a new shock fails', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    fireEvent.change(screen.getByRole('slider', { name: 'Rate rise' }), { target: { value: '125' } });
    await stress.fail(125, new ApiError('http', 'the benchmark mortgage rate is not available', 503));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The +125 bps rate shock could not be calculated.');
    expect(alert).toHaveTextContent('the benchmark mortgage rate is not available');
    expect(alert).toHaveTextContent('The figures below are still the last result, for +200 bps.');
    expect(band('Adverse')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
    await stress.answer(125);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Showing +125 bps.');
  });

  it('says plainly when al-ai refuses the account', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.fail(200, new ApiError('http', 'Only an underwriter can run a portfolio check', 403));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This account is not allowed to run portfolio stress tests. Only underwriters can.',
    );
    expect(screen.queryByRole('heading', { name: 'Affordability bands' })).not.toBeInTheDocument();
  });

  it('says when there is nothing to measure', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200, {
      shockBps: 200,
      applications: [],
      totals: { count: 0, before: counts(0, 0, 0), after: counts(0, 0, 0), movedIntoCaution: 0, movedIntoAdverse: 0 },
      skipped: [],
    });

    expect(screen.getByRole('heading', { name: 'No active applications to measure' })).toBeInTheDocument();
  });

  it('resets to +200 bps', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);
    const reset = screen.getByRole('button', { name: 'Reset to +200 bps' });
    expect(reset).toBeDisabled();

    fireEvent.change(screen.getByRole('slider', { name: 'Rate rise' }), { target: { value: '150' } });
    await stress.answer(150);
    fireEvent.click(reset);
    await waitFor(() => expect(stress.calls).toHaveLength(3));
    await stress.answer(200);

    expect(screen.getByRole('slider', { name: 'Rate rise' })).toHaveValue('200');
    expect(stress.calls.map((call) => call.shockBps)).toEqual([200, 150, 200]);
  });

  it('is linked from the underwriter header', async () => {
    renderStress(new FakeStressService(), 'underwriter', '/underwriter');

    expect(await screen.findByRole('link', { name: 'Stress test' })).toHaveAttribute('href', '/underwriter/stress');
  });

  it('is not open to brokers', async () => {
    const stress = new FakeStressService();
    renderStress(stress, 'broker');

    expect(await screen.findByRole('heading', { name: /not allowed/i })).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(stress.calls).toEqual([]);
  });
});
