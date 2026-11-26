import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bandCounts, shockFixture } from './components/stress/rateShockFixture';
import { AuthProvider } from './context/AuthContext';
import { StressServiceContext } from './context/StressContext';
import { AppRoutes, preloadPages } from './routes';
import { ApiError } from './services/apiClient';
import type { AuthService, AuthStateListener, AuthUser, TrustedRole } from './services/authService';
import type { RateShockResult, StressService } from './services/stressService';

// The page chunks load before any test renders a route, so a busy machine's slow first import is not timed.
await preloadPages();

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

  async answer(shockBps: number, result: RateShockResult = shockFixture(shockBps)) {
    const call = await this.called(shockBps);
    await act(async () => call.resolve(result));
  }

  async fail(shockBps: number, error: unknown) {
    const call = await this.called(shockBps);
    await act(async () => call.reject(error));
  }
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

// A summary tile: its big value and the line under it.
function tile(label: string) {
  const value = screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;
  return { value: value.firstElementChild?.textContent, detail: value.lastElementChild?.textContent };
}

function resultsTable() {
  return screen.getByRole('table', { name: /Rate shock results per application/ });
}

function tableRows() {
  return within(resultsTable()).getAllByRole('row').slice(1);
}

afterEach(cleanup);

describe('the rate shock page', () => {
  it('shows a skeleton while +200 bps runs on opening', async () => {
    const stress = new FakeStressService();
    renderStress(stress);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Calculating +200 bps…'));
    await stress.called(200);
    expect(screen.getByTestId('rate-shock-results')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeDisabled();
  });

  it('runs +200 bps on opening and fills the tiles from the result', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    expect(stress.calls.map((call) => call.shockBps)).toEqual([200]);
    expect(screen.getByRole('status')).toHaveTextContent('Showing +200 bps.');
    expect(screen.getByTestId('rate-shock-results')).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(tile('Applications tested')).toEqual({
      value: '4',
      detail: "3 at the committee run's rate, 1 at today's ECB rate",
    });
    expect(tile('Cross the 40% DTI limit')).toEqual({ value: '1', detail: '1 moved into Caution, 1 into Adverse' });
    expect(tile('Average DTI change')).toEqual({ value: '+6.0 pts', detail: 'per application at +2 points' });
    expect(tile('Monthly surplus change')).toEqual({ value: '−€1,150', detail: 'a month, all applications together' });
  });

  it('draws both charts with a row per application, worst first', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    const dti = screen.getByRole('region', { name: 'Debt to income, before → after' });
    expect(within(dti).getAllByRole('button').map((row) => row.getAttribute('aria-label')?.split(':')[0])).toEqual([
      'LN-1004',
      'LN-1003',
      'LN-1002',
      'LN-1001',
    ]);
    expect(within(dti).getByTestId('chart-row-LN-1002')).toHaveAttribute('data-over-limit', 'true');
    const surplus = screen.getByRole('region', { name: 'Monthly surplus change' });
    expect(within(surplus).getAllByRole('button')).toHaveLength(4);
  });

  it('lists every application worst first, each linking to its loan file, and shades the rows over the limit', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    const rows = tableRows();
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
      'LN-1004',
      'LN-1003',
      'LN-1002',
      'LN-1001',
    ]);
    expect(within(rows[1]).getByRole('link')).toHaveAttribute('href', '/underwriter/applications/LN-1003');
    expect(rows[1]).toHaveTextContent(/4\.00%\W*to 6\.00%/);
    expect(rows[1]).toHaveTextContent("Today's ECB rate: no committee run yet");
    expect(rows[1]).toHaveTextContent(/46%\W*to 53%/);
    expect(rows[1]).toHaveTextContent(/Caution\W*to Adverse/);
    expect(rows[2]).toHaveTextContent(/Comfortable\W*to Caution/);
    expect(rows.map((row) => row.getAttribute('data-over-limit'))).toEqual([null, null, 'true', null]);
    expect(rows[2]).toHaveClass('bg-danger-soft/55');
    expect(resultsTable()).toHaveAccessibleName(/at \+2 points, worst band first/);
  });

  it('lists the applications al-ai could not measure, with the reason', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    const skipped = screen.getByRole('region', { name: 'Not measured' });
    expect(within(skipped).getByRole('link', { name: 'LN-1009' })).toHaveAttribute(
      'href',
      '/underwriter/applications/LN-1009',
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

    const atThreeHundred = shockFixture(300);
    atThreeHundred.applications[0].after.dtiPct = 41;
    await stress.answer(300, atThreeHundred);
    expect(tile('Cross the 40% DTI limit').value).toBe('2');

    // The +250 answer comes back last: the page keeps showing +300.
    await stress.answer(250);
    expect(tile('Cross the 40% DTI limit').value).toBe('2');
    expect(screen.getByRole('status')).toHaveTextContent('Showing +300 bps.');
    expect(tile('Average DTI change').detail).toBe('per application at +3 points');
  });

  it('updates the figures in place for a slider run, without the skeleton', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    fireEvent.change(screen.getByRole('slider', { name: 'Rate rise' }), { target: { value: '225' } });
    await stress.called(225);
    expect(screen.getByRole('status')).toHaveTextContent('Calculating +225 bps…');
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
  });

  it('covers the figures with the skeleton while Recalculate runs', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
    await waitFor(() => expect(stress.calls).toHaveLength(2));
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId('rate-shock-results')).toHaveAttribute('aria-busy', 'true');
    await stress.answer(200);
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
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
      // The hint is on screen, but only the result shown is announced, not every step of the slider.
      expect(screen.getByText('+275 bps runs when the slider stops.')).toBeInTheDocument();
      expect(screen.getByRole('status').textContent).toBe('Showing +200 bps.');
      await act(async () => vi.advanceTimersByTime(300));
    } finally {
      vi.useRealTimers();
    }

    expect(stress.calls.map((call) => call.shockBps)).toEqual([200, 275]);
  });

  it('sends one request when Recalculate is pressed before the slider run starts', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByRole('slider', { name: 'Rate rise' }), { target: { value: '250' } });
      await act(async () => vi.advanceTimersByTime(100));
      fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
      await act(async () => vi.advanceTimersByTime(1000));
    } finally {
      vi.useRealTimers();
    }

    expect(stress.calls.map((call) => call.shockBps)).toEqual([200, 250]);
  });

  it('runs a preset chosen from the keyboard and marks it pressed', async () => {
    const user = userEvent.setup();
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    const presets = within(screen.getByRole('group', { name: 'Presets' })).getAllByRole('button');
    expect(presets.map((preset) => preset.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);

    screen.getByRole('button', { name: '+300 bps' }).focus();
    await user.keyboard('{Enter}');
    await stress.answer(300);

    expect(screen.getByRole('slider', { name: 'Rate rise' })).toHaveValue('300');
    expect(screen.getByRole('button', { name: '+300 bps' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '+200 bps' })).toHaveAttribute('aria-pressed', 'false');
    expect(stress.calls.map((call) => call.shockBps)).toEqual([200, 300]);

    screen.getByRole('button', { name: '+100 bps' }).focus();
    await user.keyboard(' ');
    await stress.answer(100);
    expect(screen.getByRole('slider', { name: 'Rate rise' })).toHaveValue('100');
  });

  it('reaches the slider, the presets and both buttons with Tab', async () => {
    const user = userEvent.setup();
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);
    fireEvent.change(screen.getByRole('slider', { name: 'Rate rise' }), { target: { value: '150' } });
    await stress.answer(150);

    screen.getByRole('slider', { name: 'Rate rise' }).focus();
    const order: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      await user.tab();
      order.push(document.activeElement?.textContent ?? '');
    }
    expect(order).toEqual(['+100', '+200', '+300', 'Recalculate', 'Reset to +200 bps']);
  });

  it('shows a brass focus ring on the controls of the dark hero, where the pine one would not show', async () => {
    renderStress(new FakeStressService());
    const controls = [
      await screen.findByRole('slider', { name: 'Rate rise' }),
      screen.getByRole('button', { name: 'Reset to +200 bps' }),
      screen.getByRole('button', { name: 'Recalculate' }),
      screen.getByRole('button', { name: '+100 bps' }),
    ];

    for (const control of controls) {
      expect(control).toHaveClass('focus-visible:outline-brass-light');
    }
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

  it('turns the dial with the slider', async () => {
    renderStress(new FakeStressService());
    const slider = await screen.findByRole('slider', { name: 'Rate rise' });
    const dial = screen.getByTestId('shock-dial');

    expect(dial).toHaveAttribute('aria-hidden', 'true');
    expect(dial).toHaveTextContent('+200bps · +2 points');
    fireEvent.change(slider, { target: { value: '275' } });
    expect(dial).toHaveTextContent('+275bps · +2.75 points');
  });

  it('keeps the last result on screen and says so when a new shock fails', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200);

    fireEvent.change(screen.getByRole('slider', { name: 'Rate rise' }), { target: { value: '125' } });
    await stress.fail(125, new ApiError('http', 'the benchmark mortgage rate is not available', 503));

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'The +125 bps rate shock could not be calculated.' })).toBeVisible();
    expect(alert).toHaveTextContent('the benchmark mortgage rate is not available');
    expect(alert).toHaveTextContent('The figures below are still the last result, for +200 bps.');
    expect(resultsTable()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
    await stress.answer(125);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Showing +125 bps.');
  });

  it('tries again from the error panel', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.fail(200, new ApiError('network', 'Could not reach the server. Check your connection and try again.'));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not reach the server.');
    expect(alert).not.toHaveTextContent('still the last result');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(stress.calls).toHaveLength(2));
    await stress.answer(200);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(tableRows()).toHaveLength(4);
  });

  it('says plainly when al-ai refuses the account', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.fail(200, new ApiError('http', 'Only an underwriter can run a portfolio check', 403));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This account is not allowed to run portfolio stress tests. Only underwriters can.',
    );
    expect(screen.queryByRole('heading', { name: 'Debt to income, before → after' })).not.toBeInTheDocument();
    expect(screen.queryByText('Applications tested')).not.toBeInTheDocument();
  });

  it('says when there is nothing to measure', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200, {
      shockBps: 200,
      applications: [],
      totals: { count: 0, before: bandCounts(0, 0, 0), after: bandCounts(0, 0, 0), movedIntoCaution: 0, movedIntoAdverse: 0 },
      skipped: [],
    });

    expect(screen.getByRole('heading', { name: 'No active applications to measure' })).toBeInTheDocument();
  });

  it('shows only the skipped list when every application was skipped', async () => {
    const stress = new FakeStressService();
    renderStress(stress);
    await stress.answer(200, {
      shockBps: 200,
      applications: [],
      totals: { count: 0, before: bandCounts(0, 0, 0), after: bandCounts(0, 0, 0), movedIntoCaution: 0, movedIntoAdverse: 0 },
      skipped: [{ applicationId: 'LN-1009', reason: 'gross_annual_income must be greater than 0' }],
    });

    expect(screen.getByRole('region', { name: 'Not measured' })).toHaveTextContent('gross_annual_income');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No active applications to measure' })).not.toBeInTheDocument();
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
