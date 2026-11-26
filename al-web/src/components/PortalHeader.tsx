import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import type { PortalRole } from '../services/authService';
import { isPortalRole } from '../utils/portalHomeFor';
import { Mark } from './Mark';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'inline-flex min-h-11 items-center rounded-lg px-4 font-medium transition-colors',
    isActive ? 'bg-tint text-pine' : 'text-muted hover:bg-tint hover:text-pine',
  ].join(' ');

interface NavItem {
  to: string;
  label: string;
  // Only the section's own page is active; deeper pages (a client file, a loan file) keep the parent link plain.
  end?: boolean;
}

// Each portal role's navigation, in the order the header shows it.
const portalNav: Record<PortalRole, { label: string; items: NavItem[] }> = {
  broker: {
    label: 'Broker portal',
    items: [
      { to: '/broker', label: 'Overview', end: true },
      { to: '/broker/clients', label: 'My clients' },
      { to: '/broker/messages', label: 'Messages' },
    ],
  },
  underwriter: {
    label: 'Underwriter portal',
    items: [
      { to: '/underwriter', label: 'Overview', end: true },
      { to: '/underwriter/pipeline', label: 'Pipeline' },
      { to: '/underwriter/stress', label: 'Stress test' },
    ],
  },
  admin: {
    label: 'Admin portal',
    items: [
      { to: '/admin', label: 'Dashboard', end: true },
      { to: '/admin/staff', label: 'Staff' },
      { to: '/admin/inbox', label: 'Inbox' },
      { to: '/admin/business', label: 'Business' },
    ],
  },
};

export function PortalHeader() {
  const { signOut, action, role, authError } = useAuth();
  const navigate = useNavigate();
  const nav = isPortalRole(role) ? portalNav[role] : null;

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      // The provider exposes a safe error while retaining the authenticated state.
    }
  };

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex min-h-20 w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
        {nav ? (
          <Link
            aria-label={`Agentic Lender, ${role} overview`}
            className="inline-flex min-h-11 items-center rounded-lg text-pine transition-opacity duration-200 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pine"
            to={nav.items[0].to}
          >
            <Mark />
          </Link>
        ) : (
          <div className="text-pine">
            <Mark />
          </div>
        )}
        {nav ? (
          <nav aria-label={nav.label} className="flex flex-wrap gap-1">
            {nav.items.map((item) => (
              <NavLink className={navLinkClass} end={item.end} key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
        <button
          className="ml-auto min-h-11 cursor-pointer rounded-lg border border-pine px-4 py-2 font-semibold text-pine transition-colors hover:bg-tint disabled:cursor-not-allowed disabled:opacity-60"
          disabled={action === 'signing-out'}
          onClick={() => void handleSignOut()}
          type="button"
        >
          {action === 'signing-out' ? 'Signing out…' : 'Sign out'}
        </button>
        {authError ? (
          <p className="w-full text-right text-sm text-error" role="alert">
            {authError}
          </p>
        ) : null}
      </div>
    </header>
  );
}
