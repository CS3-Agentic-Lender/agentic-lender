import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downturnFixture } from './components/stress/housePriceFixture';
import { AuthProvider } from './context/AuthContext';
import { StressServiceContext } from './context/StressContext';
import { AppRoutes, preloadPages } from './routes';
import { ApiError } from './services/apiClient';
import type { AuthService, AuthStateListener, AuthUser, TrustedRole } from './services/authService';
import type { DownturnResult, StressService } from './services/stressService';

// jsdom has no WebGL: the stage leaves its 3D view out unless a test turns it on and stands in for the scene.
const draw = vi.hoisted(() => ({ supported: false }));
vi.mock('./components/lending/council/canDraw3d', async (original) => ({
  ...(await original<typeof import('./components/lending/council/canDraw3d')>()),
  canDraw3d: () => draw.supported,
}));
const scene = vi.hoisted(() => ({ select: null as ((id: string) => void) | null }));
vi.mock('./components/stress/housePriceScene', () => ({
  createHousePriceScene: (_host: HTMLElement, options: { onSelect?(id: string): void }) => {
    scene.select = options.onSelect ?? null;
    return { update() {}, dispose() {} };
  },
}));

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
  fallPct: number;
  resolve: (result: DownturnResult) => void;
  reject: (error: unknown) => void;
}

// Each call waits until the test answers it, so the test decides the order answers arrive in.
class FakeStressService implements StressService {
  readonly calls: Call[] = [];
  rateShock = vi.fn();

  houseDownturn(fallPct: number) {
    return new Promise<DownturnResult>((resolve, reject) => {
      this.calls.push({ fallPct, resolve, reject });
    });
  }

  async called(fallPct: number) {
    await waitFor(() => expect(this.calls.map((call) => call.fallPct)).toContain(fallPct));
    return this.calls.filter((call) => call.fallPct === fallPct).at(-1)!;
  }

  async answer(fallPct: number, result: DownturnResult = downturnFixture(fallPct)) {
    const call = await this.called(fallPct);
    await act(async () => call.resolve(result));
  }

  async fail(fallPct: number, error: unknown) {
    const call = await this.called(fallPct);
    await act(async () => call.reject(error));
  }
}

function renderStress(stress: StressService, role: TrustedRole = 'underwriter', path = '/underwriter/stress/house-prices') {
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

afterEach(() => {
  cleanup(); draw.supported = false; scene.select = null; vi.unstubAllGlobals();
});
const table = () => screen.getByRole('table', { name: 'House price fall results per application' });
const crossing = () => screen.getByRole('region', { name: 'Loans crossing 90%' });
const tile = (name: string) => screen.getByText(name, { selector: 'dt' }).nextElementSibling!;
const slider = () => screen.getByRole('slider', { name: 'Price fall' });

describe('house price fall page', () => {
  it('loads the default fall with a skeleton and accessible controls inside the stage', async () => {
    const service = new FakeStressService(); renderStress(service);
    await service.called(10);
    expect(screen.getByRole('status')).toHaveTextContent('Calculating \u221210%');
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(4);
    const stage = screen.getByRole('region', { name: 'House price fall stage' });
    expect(stage).toContainElement(slider());
    expect(slider()).toHaveAttribute('min', '0'); expect(slider()).toHaveAttribute('max', '40'); expect(slider()).toHaveAttribute('step', '5');
    expect(screen.getByRole('button', { name: 'Recalculate' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/3D view unavailable/)).toBeInTheDocument();
  });
  it('shows the backend totals, note, value basis, exact boundaries and crossing-loan links', async () => {
    const service = new FakeStressService(); renderStress(service); await service.answer(10);
    expect(tile('Applications tested')).toHaveTextContent('4');
    expect(tile('Above 80%')).toHaveTextContent('3 \u2192 3');
    expect(tile('Above 90%')).toHaveTextContent('1 \u2192 2');
    expect(tile('Loan amount above 90% after')).toHaveTextContent('\u20ac370,000');
    expect(screen.getByText(downturnFixture().note)).toBeInTheDocument();
    expect(within(crossing()).getAllByRole('link')).toHaveLength(1);
    expect(within(crossing()).getByRole('link', { name: 'LN-1003' })).toHaveAttribute('href', '/underwriter/applications/LN-1003');
    const rows = within(table()).getAllByRole('row');
    const exact90 = rows.find((row) => row.textContent?.includes('LN-1002'))!;
    expect(exact90).toHaveTextContent('90.00%'); expect(exact90).toHaveTextContent('After: Above 80%: Yes; Above 90%: No');
    const exact80 = rows.find((row) => row.textContent?.includes('LN-1001'))!;
    expect(exact80).toHaveTextContent('80.00%'); expect(exact80).toHaveTextContent('After: Above 80%: No; Above 90%: No');
    expect(table()).toHaveTextContent('Model estimate'); expect(table()).toHaveTextContent('Asking price');
    expect(screen.getByRole('region', { name: 'Not measured' })).toHaveTextContent('no estimate yet');
    expect(screen.getByRole('link', { name: 'House prices' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Stress test' })).not.toHaveAttribute('aria-current');
  });
  it('supports keyboard presets, zero, maximum fall and reset without losing focus', async () => {
    const user = userEvent.setup(); const service = new FakeStressService(); renderStress(service); await service.answer(10);
    const zero = screen.getByRole('button', { name: '0%' }); zero.focus(); await user.keyboard('{Enter}'); await service.answer(0);
    expect(zero).toHaveFocus(); expect(slider()).toHaveValue('0');
    expect(tile('Above 90%')).toHaveTextContent('1 \u2192 1');
    expect(screen.getByText('No loans cross 90% at this fall.')).toBeInTheDocument();
    screen.getByRole('button', { name: '\u221240%' }).focus(); await user.keyboard(' '); await service.answer(40);
    expect(slider()).toHaveValue('40'); expect(tile('Above 90%')).toHaveTextContent('1 \u2192 4');
    const reset = screen.getByRole('button', { name: 'Reset to \u221210%' }); reset.focus(); await user.keyboard('{Enter}'); await service.answer(10);
    expect(reset).toHaveFocus(); expect(reset).toHaveAttribute('aria-disabled', 'true');
    expect(slider()).toHaveValue('10');
  });
  it('debounces slider steps for 300ms and keeps the latest answer', async () => {
    const service = new FakeStressService(); renderStress(service); await service.answer(10);
    vi.useFakeTimers();
    try {
      fireEvent.change(slider(), { target: { value: '15' } }); await act(async () => vi.advanceTimersByTime(100));
      fireEvent.change(slider(), { target: { value: '20' } }); await act(async () => vi.advanceTimersByTime(299));
      expect(service.calls.map((call) => call.fallPct)).toEqual([10]);
      await act(async () => vi.advanceTimersByTime(1));
    } finally { vi.useRealTimers(); }
    await service.called(20);
    fireEvent.change(slider(), { target: { value: '40' } }); await service.answer(40);
    await service.answer(20);
    expect(screen.getByRole('status')).toHaveTextContent('Showing \u221240%.');
    expect(tile('Above 90%')).toHaveTextContent('1 \u2192 4');
  });
  it('drops an obsolete answer even during the debounce window of a newer choice', async () => {
    const service = new FakeStressService(); renderStress(service); await service.answer(10);
    fireEvent.change(slider(), { target: { value: '20' } }); await service.called(20);
    fireEvent.change(slider(), { target: { value: '40' } });
    await service.answer(20);
    expect(tile('Above 90%')).toHaveTextContent('1 \u2192 2');
    await service.answer(40); expect(tile('Above 90%')).toHaveTextContent('1 \u2192 4');
  });
  it('recalculates once, keeps focus and covers old figures with a skeleton', async () => {
    const user = userEvent.setup(); const service = new FakeStressService(); renderStress(service); await service.answer(10);
    const recalculate = screen.getByRole('button', { name: 'Recalculate' }); recalculate.focus(); await user.keyboard('{Enter}{Enter}');
    expect(service.calls).toHaveLength(2); expect(recalculate).toHaveFocus();
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(4); await service.answer(10);
    expect(recalculate).toHaveAttribute('aria-disabled', 'false');
  });
  it('shows an error with Try again and retains clearly labelled previous figures', async () => {
    const service = new FakeStressService(); renderStress(service); await service.answer(10);
    fireEvent.change(slider(), { target: { value: '20' } }); await service.fail(20, new Error('Calculation unavailable'));
    expect(screen.getByRole('alert')).toHaveTextContent('Calculation unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('last result, for \u221210%');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await service.answer(20);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recalculate' })).toHaveFocus();
  });
  it('explains a 403 without inventing results', async () => {
    const service = new FakeStressService(); renderStress(service); await service.fail(10, new ApiError('http', 'Forbidden', 403));
    expect(screen.getByRole('alert')).toHaveTextContent('Only underwriters can'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('blocks a broker before calling the endpoint', async () => {
    const service = new FakeStressService(); renderStress(service, 'broker');
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument(); expect(service.calls).toHaveLength(0);
  });
  it('handles an empty portfolio', async () => {
    const service = new FakeStressService(); renderStress(service);
    const empty = downturnFixture(); empty.applications = []; empty.skipped = []; empty.totals = { count: 0, before: { above_80: { count: 0, loan_eur: 0 }, above_90: { count: 0, loan_eur: 0 } }, after: { above_80: { count: 0, loan_eur: 0 }, above_90: { count: 0, loan_eur: 0 } } };
    await service.answer(10, empty); expect(screen.getByText('No active applications to measure')).toBeInTheDocument(); expect(tile('Applications tested')).toHaveTextContent('0');
  });
  it('scrolls to, focuses and marks the full-table row of a clicked tower', async () => {
    draw.supported = true;
    let near: ((entries: { isIntersecting: boolean }[]) => void) | undefined; let idle: (() => void) | undefined;
    vi.stubGlobal('IntersectionObserver', class { constructor(cb: typeof near) { near = cb; } observe() {} disconnect() {} });
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => { idle = cb; return 1; }); vi.stubGlobal('cancelIdleCallback', () => {});
    const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
    const service = new FakeStressService(); renderStress(service); await service.answer(10);
    act(() => near?.([{ isIntersecting: true }])); await act(async () => { idle?.(); }); await waitFor(() => expect(scene.select).not.toBeNull());
    act(() => scene.select?.('LN-1003'));
    const row = document.getElementById('downturn-row-LN-1003')!;
    expect(row).toHaveAttribute('data-picked', 'true'); expect(within(row).getByRole('link')).toHaveFocus(); expect(scroll).toHaveBeenCalledOnce();
  });
});
