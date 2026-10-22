import { afterEach, describe, expect, it, vi } from 'vitest';
import { firebaseAuthService, getSignInErrorMessage, resolveRoleClaim, type AuthUser } from './authService';
import { onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { auth } from './firebase';

vi.mock('firebase/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/auth')>(),
  onIdTokenChanged: vi.fn(() => vi.fn()),
  onAuthStateChanged: vi.fn(() => vi.fn()),
}));

it('subscribes to ID token changes instead of only auth state changes', () => {
  const listener = vi.fn();
  const onError = vi.fn();
  const unsubscribe = firebaseAuthService.subscribe(listener, onError);
  expect(onIdTokenChanged).toHaveBeenCalledWith(auth, listener, onError);
  expect(onAuthStateChanged).not.toHaveBeenCalled();
  expect(unsubscribe).toBe(vi.mocked(onIdTokenChanged).mock.results[0].value);
});

describe('trusted Firebase role claims', () => {
  it('reads the trusted role from the user ID token result', async () => {
    const getIdTokenResult = vi.fn(async () => ({ claims: { role: 'underwriter' } }) as never);
    const user: AuthUser = {
      uid: 'underwriter-1',
      email: 'underwriter@example.test',
      getIdToken: vi.fn(),
      getIdTokenResult,
    };

    await expect(firebaseAuthService.resolveTrustedRole(user)).resolves.toEqual({
      role: 'underwriter',
      denialReason: null,
    });
    expect(getIdTokenResult).toHaveBeenCalledExactlyOnceWith();
  });

  it('propagates a failed ID token lookup rather than returning a role refusal', async () => {
    const failure = new Error('token unavailable');
    const user: AuthUser = {
      uid: 'broker-1',
      email: 'broker@example.test',
      getIdToken: vi.fn(),
      getIdTokenResult: vi.fn().mockRejectedValue(failure),
    };

    await expect(firebaseAuthService.resolveTrustedRole(user)).rejects.toBe(failure);
    expect(user.getIdTokenResult).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(['broker', 'underwriter', 'borrower'] as const)('recognizes the %s custom claim', (role) => {
    expect(resolveRoleClaim({ role })).toEqual({ role, denialReason: null });
  });

  it.each([
    ['missing', {}, 'missing-role'],
    ['unknown', { role: 'admin' }, 'unknown-role'],
    ['malformed', { role: ['broker'] }, 'malformed-role'],
  ] as const)('default-denies a %s role claim', (_label, claims, denialReason) => {
    expect(resolveRoleClaim(claims)).toEqual({ role: null, denialReason });
  });
});

describe('authentication errors', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows a neutral message for an unknown sign-in failure in a production build', () => {
    vi.stubEnv('DEV', false);

    const message = getSignInErrorMessage(new Error('internal implementation detail'));

    expect(message).toBe('Sign-in failed. Try again.');
    expect(message).not.toContain('emulator');
    expect(message).not.toContain('internal implementation detail');
  });

  it('adds the emulator hint for an unknown sign-in failure in a development build', () => {
    vi.stubEnv('DEV', true);

    const message = getSignInErrorMessage(new Error('internal implementation detail'));

    expect(message).toBe(
      'Sign-in failed. Try again. In development, check that the Auth emulator is running.',
    );
    expect(message).not.toContain('internal implementation detail');
  });
});
