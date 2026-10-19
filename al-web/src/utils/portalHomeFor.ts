import type { TrustedRole } from '../services/authService';

export function portalHomeFor(role: TrustedRole | null) {
  if (role === 'broker') {
    return '/broker';
  }

  if (role === 'underwriter') {
    return '/underwriter';
  }

  return '/forbidden';
}
