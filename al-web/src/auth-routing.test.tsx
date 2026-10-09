import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
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
      const resolution = await this.nextResolution;
      this.nextResolution = null;
      return resolution;
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

function renderAt(pathname: string, auth: FakeAuthService) {
  return render(
    <AuthProvider service={auth}>
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

  it('refuses borrower accounts with the required portal message', async () => {
    const auth = new FakeAuthService({ resolution: { role: 'borrower', denialReason: null } });
    renderAt('/broker', auth);
    auth.restore({ ...brokerUser, uid: 'borrower-1' });
    expect(await screen.findByText('This portal is for brokers and bank staff.')).toBeInTheDocument();
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
    expect(screen.queryByRole('heading', { name: 'Broker portal' })).not.toBeInTheDocument();
  });

  it('denies access when trusted claim retrieval fails', async () => {
    const auth = new FakeAuthService({ resolutionError: new Error('token unavailable') });
    renderAt('/broker', auth);
    auth.restore(brokerUser);
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
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
    expect(await screen.findByText('Firebase sign-out failed. Try again.')).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { name: 'Authentication unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Firebase authentication could not be restored.')).toBeInTheDocument();
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

