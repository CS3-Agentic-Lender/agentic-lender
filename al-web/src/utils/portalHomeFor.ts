import type { PortalRole, TrustedRole } from '../services/authService';

const PORTAL_HOMES: Record<PortalRole, string> = {
  broker: '/broker',
  underwriter: '/underwriter',
  admin: '/admin',
};

export function isPortalRole(role: TrustedRole | null): role is PortalRole {
  return role !== null && role in PORTAL_HOMES;
}

export function portalHomeFor(role: TrustedRole | null) {
  return isPortalRole(role) ? PORTAL_HOMES[role] : '/forbidden';
}
