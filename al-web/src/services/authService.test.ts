import { describe, expect, it } from 'vitest';
import { getSignInErrorMessage, resolveRoleClaim } from './authService';

describe('trusted Firebase role claims', () => {
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
  it('does not expose Firebase internals for an unknown sign-in failure', () => {
    expect(getSignInErrorMessage(new Error('internal implementation detail'))).toBe(
      'Sign-in failed. Check the Auth emulator and try again.',
    );
  });
});
