import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './context/AuthContext';
import { AppRoutes } from './routes';
import type {
  AuthService,
  AuthErrorListener,
  AuthStateListener,
  AuthUser,
  RoleResolution,
} from './services/authService';

const brokerUser: AuthUser = {
  uid: 'broker-1',
  email: 'broker@example.test',
  getIdToken: async () => 'broker-id-token',
  getIdTokenResult: async () => ({ claims: { role: 'broker' } }) as never,
};

const underwriterUser: AuthUser = {
  uid: 'underwriter-1',
  email: 'underwriter@example.test',
  getIdToken: async () => 'underwriter-id-token',
  getIdTokenResult: async () => ({ claims: { role: 'underwriter' } }) as never,
};

const TEST_PASSWORD = 'test-only-credential'; // betterleaks:allow — local Vitest fixture, never a real credential

interface FakeAuthOptions {
  resolution?: RoleResolution;
  resolutionError?: Error;
  signInError?: { code: string };
  signInUser?: AuthUser;
  signOutError?: Error;
}

class FakeAuthService implements AuthService {
  private listener: AuthStateListener | null = null;
  private errorListener: AuthErrorListener | null = null;
  private resolution: RoleResolution;
  private nextResolution: Promise<RoleResolution> | null = null;
  readonly signInCalls: Array<{ email: string; password: string }> = [];

  constructor(private readonly options: FakeAuthOptions = {}) {
    this.resolution = options.resolution ?? { role: 'broker', denialReason: null };
  }

  subscribe(listener: AuthStateListener, onError?: AuthErrorListener) {
    this.listener = listener;
    this.errorListener = onError ?? null;
    return () => {
      this.listener = null;
      this.errorListener = null;
    };
  }

  async signIn(email: string, password: string) {
    this.signInCalls.push({ email, password });

    if (this.options.signInError) {
      throw this.options.signInError;
    }

    if (this.options.signInUser) {
      this.listener?.(this.options.signInUser);
    }
  }

  async signOut() {
    if (this.options.signOutError) {
      throw this.options.signOutError;
    }

    this.listener?.(null);
  }

  async resolveTrustedRole() {
    if (this.options.resolutionError) {
      throw this.options.resolutionError;
    }

    if (this.nextResolution) {
      const pending = this.nextResolution;
      this.nextResolution = null;
      return pending;
    }

    return this.resolution;
  }

  async getCurrentIdToken() {
    return 'emulator-id-token';
  }

  restore(user: AuthUser | null) {
    this.listener?.(user);
  }

  changeRole(resolution: RoleResolution) {
    this.resolution = resolution;
  }

  deferNextRole(resolution: Promise<RoleResolution>) {
    this.nextResolution = resolution;
  }

  failRestoration() {
    this.errorListener?.(new Error('restoration failed'));
  }
}

function renderAt(pathname: string, auth: FakeAuthService, resetSession = vi.fn()) {
  return render(
    <AuthProvider service={auth} resetSession={resetSession}>
      <MemoryRouter initialEntries={[pathname]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('authenticated routing', () => {
  it('allows a broker to open the broker route after trusted claims resolve', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'broker', denialReason: null } });
    renderAt('/broker', auth);
    auth.restore(brokerUser);
    expect(await screen.findByRole('heading', { name: 'Broker portal' })).toBeInTheDocument();
  });

  it('allows an underwriter to open the underwriter route', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'underwriter', denialReason: null } });
    renderAt('/underwriter', auth);
    auth.restore(underwriterUser);
    expect(await screen.findByRole('heading', { name: 'Underwriter portal' })).toBeInTheDocument();
  });

  it('denies a broker who navigates directly to the underwriter route', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'broker', denialReason: null } });
    renderAt('/underwriter', auth);
    auth.restore(brokerUser);
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Underwriter portal' })).not.toBeInTheDocument();
  });

  it('offers a denied broker a link back to the broker portal', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'broker', denialReason: null } });
    renderAt('/underwriter', auth);
    auth.restore(brokerUser);
    const user = userEvent.setup();
    const link = await screen.findByRole('link', { name: 'Go to the broker portal' });
    expect(link).toHaveAttribute('href', '/broker');
    await user.click(link);
    expect(await screen.findByRole('heading', { name: 'Broker portal' })).toBeInTheDocument();
  });

  it('offers a denied underwriter a link back to the underwriter portal', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'underwriter', denialReason: null } });
    renderAt('/broker', auth);
    auth.restore(underwriterUser);
    const link = await screen.findByRole('link', { name: 'Go to the underwriter portal' });
    expect(link).toHaveAttribute('href', '/underwriter');
  });

  it('refuses borrower accounts with the required portal message', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'borrower', denialReason: null } });
    renderAt('/broker', auth);
    auth.restore({ ...brokerUser, uid: 'borrower-1' });
    expect(await screen.findByText('This portal is for brokers and bank staff.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /portal/ })).not.toBeInTheDocument();
  });

  it('shows the not-found page for an unknown path', async () => {
    const auth = new FakeAuthService();
    renderAt('/no-such-page', auth);
    auth.restore(null);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to portal access' })).toHaveAttribute('href', '/');
  });

  it('lets a refused borrower sign out and removes the denied session', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'borrower', denialReason: null } });
    renderAt('/broker', auth);
    auth.restore({ ...brokerUser, uid: 'borrower-1' });
    const user = userEvent.setup();
    await screen.findByText('This portal is for brokers and bank staff.');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Portal access' })).toBeInTheDocument();
  });

  it.each([
    ['missing', { role: null, denialReason: 'missing-role' }],
    ['unknown', { role: null, denialReason: 'unknown-role' }],
    ['malformed', { role: null, denialReason: 'malformed-role' }],
  ] as const)('denies an authenticated account with a %s role claim', async (_label, resolution) => {
    const auth = new FakeAuthService({ resolution });
    renderAt('/broker', auth);
    auth.restore(brokerUser);
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
    expect(screen.getByText('Ask an administrator to check your account access.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Broker portal' })).not.toBeInTheDocument();
  });

  it.each(['/broker', '/login', '/forbidden'])('offers a session retry when token lookup fails on %s', async (path) => {
    const auth = new FakeAuthService({ resolutionError: new Error('token unavailable') });
    const resetSession = vi.fn();
    renderAt(path, auth, resetSession);
    auth.restore(brokerUser);
    expect(await screen.findByText('We could not verify your session, reload to try again')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Not allowed' })).not.toBeInTheDocument();
    expect(screen.queryByText(/administrator/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Broker portal' })).not.toBeInTheDocument();
    expect(resetSession).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(resetSession).toHaveBeenCalledWith();
  });

  it('redirects an anonymous direct navigation to sign in', async () => {
    const auth = new FakeAuthService();
    renderAt('/broker', auth);
    auth.restore(null);
    expect(await screen.findByRole('heading', { name: 'Portal access' })).toBeInTheDocument();
  });

  it('ignores local and URL role spoofing', async () => {
    window.localStorage.setItem('role', 'broker');
    window.sessionStorage.setItem('role', 'broker');
    const auth = new FakeAuthService({ resolution: { role: null, denialReason: 'missing-role' } });
    renderAt('/broker?role=broker', auth);
    auth.restore(brokerUser);
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
  });

  it('hides protected content while Firebase restores the session and role claim', () => {
    const auth = new FakeAuthService();
    renderAt('/broker', auth);
    expect(screen.getByRole('heading', { name: 'Checking portal access' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Broker portal' })).not.toBeInTheDocument();
  });

  it('restores a valid session on a protected deep link', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'broker', denialReason: null } });
    renderAt('/broker', auth);
    expect(screen.getByRole('heading', { name: 'Checking portal access' })).toBeInTheDocument();
    auth.restore(brokerUser);
    expect(await screen.findByRole('heading', { name: 'Broker portal' })).toBeInTheDocument();
  });

  it('removes protected access immediately after sign-out', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'broker', denialReason: null } });
    renderAt('/broker', auth);
    auth.restore(brokerUser);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Portal access' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Broker portal' })).not.toBeInTheDocument();
  });

  it('does not pretend a failed Firebase sign-out removed the persisted session', async () => {
    const auth = new FakeAuthService({
      resolution: { role: 'broker', denialReason: null },
      signOutError: new Error('persistence failure'),
    });
    renderAt('/broker', auth);
    auth.restore(brokerUser);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Sign-out failed. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Broker portal' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Portal access' })).not.toBeInTheDocument();
  });

  it('clears a stale allowed role before resolving an identity change', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'broker', denialReason: null } });
    renderAt('/broker', auth);
    auth.restore(brokerUser);
    expect(await screen.findByRole('heading', { name: 'Broker portal' })).toBeInTheDocument();
    let finishRoleCheck: (resolution: RoleResolution) => void = () => undefined;
    auth.deferNextRole(
      new Promise((resolve) => {
        finishRoleCheck = resolve;
      }),
    );
    await act(async () => {
      auth.restore({ ...brokerUser, uid: 'borrower-2' });
    });
    expect(await screen.findByRole('heading', { name: 'Checking portal access' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Broker portal' })).not.toBeInTheDocument();
    finishRoleCheck({ role: 'borrower', denialReason: null });
    expect(await screen.findByText('This portal is for brokers and bank staff.')).toBeInTheDocument();
  });
});

describe('login', () => {
  it('shows a recoverable error instead of looping when session restoration fails', async () => {
    const auth = new FakeAuthService();
    renderAt('/login', auth);
    auth.failRestoration();
    expect(await screen.findByRole('heading', { name: 'Session unavailable' })).toBeInTheDocument();
    expect(screen.getByText('We could not verify your session, reload to try again')).toBeInTheDocument();
  });

  it('submits email and password without asking the user to choose a role', async () => {
    const auth = new FakeAuthService({
      resolution: { role: 'broker', denialReason: null },
      signInUser: brokerUser,
    });
    renderAt('/login', auth);
    auth.restore(null);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email address'), 'broker@example.test');
    await user.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Broker portal' })).toBeInTheDocument();
    expect(auth.signInCalls).toEqual([{ email: 'broker@example.test', password: TEST_PASSWORD }]);
  });

  it.each([
    ['underwriter', 'Underwriter portal'],
    ['borrower', 'Not allowed'],
  ] as const)('submits the login form for an %s account', async (role, heading) => {
    const account = { ...underwriterUser, uid: `${role}-1`, email: `${role}@example.test` };
    const auth = new FakeAuthService({
      resolution: { role, denialReason: null },
      signInUser: account,
    });
    renderAt('/login', auth);
    auth.restore(null);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email address'), account.email);
    await user.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(auth.signInCalls).toEqual([{ email: account.email, password: TEST_PASSWORD }]);
    if (role === 'borrower') {
      expect(screen.getByText('This portal is for brokers and bank staff.')).toBeInTheDocument();
    }
  });

  it.each([
    ['broker', brokerUser, 'Broker portal'],
    ['underwriter', underwriterUser, 'Underwriter portal'],
  ] as const)('redirects a signed-in %s opening login to their portal home', async (role, account, heading) => {
    const auth = new FakeAuthService({ resolution: { role, denialReason: null } });
    renderAt('/login', auth);
    auth.restore(account);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(auth.signInCalls).toEqual([]);
  });

  it('shows a safe invalid-credentials error beside the form', async () => {
    const auth = new FakeAuthService({ signInError: { code: 'auth/invalid-credential' } });
    renderAt('/login', auth);
    auth.restore(null);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email address'), 'broker@example.test');
    await user.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
  });
});


function deferredRole() {
  let resolve!: (resolution: RoleResolution) => void;
  const promise = new Promise<RoleResolution>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('session boundaries', () => {
  it('keeps forbidden content hidden until the account role resolves', async () => {
    const auth = new FakeAuthService();
    const pending = deferredRole();
    auth.deferNextRole(pending.promise);
    renderAt('/forbidden', auth);
    expect(screen.getByRole('heading', { name: 'Checking portal access' })).toBeInTheDocument();
    act(() => auth.restore(brokerUser));
    expect(screen.getByRole('heading', { name: 'Checking portal access' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Not allowed' })).not.toBeInTheDocument();
    expect(screen.queryByText(/administrator/i)).not.toBeInTheDocument();
    await act(async () => pending.resolve({ role: null, denialReason: 'missing-role' }));
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
  });

  it('blocks a same-user downgrade while resolving and resets once at the current location', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'underwriter', denialReason: null } });
    const resetSession = vi.fn();
    renderAt('/underwriter', auth, resetSession);
    auth.restore(underwriterUser);
    await screen.findByRole('heading', { name: 'Underwriter portal' });
    expect(resetSession).not.toHaveBeenCalled();

    const pending = deferredRole();
    auth.deferNextRole(pending.promise);
    act(() => auth.restore(underwriterUser));
    expect(screen.getByRole('heading', { name: 'Checking portal access' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Underwriter portal' })).not.toBeInTheDocument();
    await act(async () => pending.resolve({ role: 'broker', denialReason: null }));
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(resetSession).toHaveBeenCalledWith();

    auth.changeRole({ role: 'broker', denialReason: null });
    await act(async () => auth.restore(underwriterUser));
    expect(resetSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing', { role: null, denialReason: 'missing-role' }],
    ['unknown', { role: null, denialReason: 'unknown-role' }],
    ['malformed', { role: null, denialReason: 'malformed-role' }],
  ] as const)('refuses a same-user refresh with a %s role', async (_label, resolution) => {
    const auth = new FakeAuthService({ resolution: { role: 'underwriter', denialReason: null } });
    const resetSession = vi.fn();
    renderAt('/underwriter', auth, resetSession);
    auth.restore(underwriterUser);
    await screen.findByRole('heading', { name: 'Underwriter portal' });
    const pending = deferredRole();
    auth.deferNextRole(pending.promise);
    act(() => auth.restore(underwriterUser));
    expect(screen.queryByRole('heading', { name: 'Underwriter portal' })).not.toBeInTheDocument();
    await act(async () => pending.resolve(resolution));
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Underwriter portal' })).not.toBeInTheDocument();
    expect(resetSession).not.toHaveBeenCalled();
  });

  it('restores an unchanged role as soon as its refresh resolves without resetting', async () => {
    const auth = new FakeAuthService();
    const resetSession = vi.fn();
    renderAt('/broker', auth, resetSession);
    auth.restore(brokerUser);
    await screen.findByRole('heading', { name: 'Broker portal' });
    await act(async () => auth.restore(brokerUser));
    expect(screen.getByRole('heading', { name: 'Broker portal' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Checking portal access' })).not.toBeInTheDocument();
    expect(resetSession).not.toHaveBeenCalled();
  });

  it('ignores a slow older refresh after a newer role resolution', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'underwriter', denialReason: null } });
    const resetSession = vi.fn();
    renderAt('/underwriter', auth, resetSession);
    auth.restore(underwriterUser);
    await screen.findByRole('heading', { name: 'Underwriter portal' });
    const older = deferredRole();
    auth.deferNextRole(older.promise);
    act(() => auth.restore(underwriterUser));
    auth.changeRole({ role: 'broker', denialReason: null });
    await act(async () => auth.restore(underwriterUser));
    await screen.findByRole('heading', { name: 'Not allowed' });
    await act(async () => older.resolve({ role: 'underwriter', denialReason: null }));
    expect(screen.getByRole('link', { name: 'Go to the broker portal' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Underwriter portal' })).not.toBeInTheDocument();
    expect(resetSession).toHaveBeenCalledTimes(1);
  });

  it('ignores an older identity resolution after sign-out', async () => {
    const auth = new FakeAuthService();
    const resetSession = vi.fn();
    renderAt('/broker', auth, resetSession);
    const older = deferredRole();
    auth.deferNextRole(older.promise);
    act(() => auth.restore(brokerUser));
    act(() => auth.restore(null));
    await act(async () => older.resolve({ role: 'broker', denialReason: null }));
    expect(screen.getByRole('heading', { name: 'Portal access' })).toBeInTheDocument();
    expect(resetSession).not.toHaveBeenCalled();
  });

  it('resets exactly once to login after successful explicit sign-out', async () => {
    const auth = new FakeAuthService();
    const resetSession = vi.fn();
    renderAt('/broker', auth, resetSession);
    auth.restore(brokerUser);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(resetSession).toHaveBeenCalledWith('/login');
    expect(screen.queryByRole('heading', { name: 'Broker portal' })).not.toBeInTheDocument();
  });

  it.each([
    ['/broker', 'Broker portal'],
    ['/underwriter', 'Not allowed'],
  ])('shows a safe sign-out alert beside the button on %s and retains the session', async (path, heading) => {
    const auth = new FakeAuthService({ signOutError: new Error('private persistence detail') });
    const resetSession = vi.fn();
    renderAt(path, auth, resetSession);
    auth.restore(brokerUser);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Sign-out failed. Try again.');
    expect(screen.queryByText('private persistence detail')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' }).parentElement).toContainElement(alert);
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(resetSession).not.toHaveBeenCalled();
  });

  it('does not reset on initial sign-in or restored page load', async () => {
    const auth = new FakeAuthService({ signInUser: brokerUser });
    const resetSession = vi.fn();
    const view = renderAt('/login', auth, resetSession);
    act(() => auth.restore(null));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email address'), 'broker@example.test');
    await user.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Broker portal' });
    expect(resetSession).not.toHaveBeenCalled();
    view.unmount();
    renderAt('/broker', auth, resetSession);
    auth.restore(brokerUser);
    await screen.findByRole('heading', { name: 'Broker portal' });
    expect(resetSession).not.toHaveBeenCalled();
  });
});
