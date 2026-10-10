import { NavLink, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Mark } from './Mark';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'inline-flex min-h-11 items-center rounded-lg px-4 font-medium transition-colors',
    isActive ? 'bg-tint text-pine' : 'text-muted hover:bg-tint hover:text-pine',
  ].join(' ');

export function PortalHeader() {
  const { signOut, action, role } = useAuth();
  const navigate = useNavigate();

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
        <div className="text-pine">
          <Mark />
        </div>
        {role === 'broker' ? (
          <nav aria-label="Broker portal" className="flex flex-wrap gap-1">
            <NavLink className={navLinkClass} end to="/broker">
              Overview
            </NavLink>
            <NavLink className={navLinkClass} to="/broker/clients">
              My clients
            </NavLink>
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
      </div>
    </header>
  );
}
