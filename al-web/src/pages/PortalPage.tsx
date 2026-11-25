import { PortalHeader } from '../components/PortalHeader';
import { useAuth } from '../context/AuthContext';
import type { PortalRole } from '../services/authService';
import { BrokerOverview } from './broker/BrokerOverview';
import { UnderwriterOverview } from './underwriter/UnderwriterOverview';

type OverviewRole = Exclude<PortalRole, 'admin'>;

interface PortalPageProps {
  role: OverviewRole;
}

const headings: Record<OverviewRole, string> = {
  broker: 'Broker portal',
  underwriter: 'Underwriter portal',
};

// Each portal's home: its overview. The route supplies the data provider the overview reads from.
export function PortalPage({ role }: PortalPageProps) {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-oat text-ink">
      <PortalHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <p className="font-mono text-xs font-medium tracking-widest text-muted uppercase">Overview</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{headings[role]}</h1>
        <p className="mt-3 text-muted">
          Signed in as {user?.email ?? 'an authenticated user'}.
        </p>

        {role === 'broker' ? <BrokerOverview /> : <UnderwriterOverview />}
      </main>
    </div>
  );
}
