import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import type { PortalRole } from '../../services/authService';
import { AuthLoadingPage } from './AuthLoadingPage';
import { SessionRetryPage } from './SessionRetryPage';

interface RequireRoleProps {
  allowedRoles: readonly PortalRole[];
}

export function RequireRole({ allowedRoles }: RequireRoleProps) {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <AuthLoadingPage />;
  }

  if (auth.status === 'anonymous') {
    return <Navigate replace to="/login" />;
  }

  if (auth.status === 'error') {
    return <SessionRetryPage />;
  }

  if (auth.status === 'authenticated' && auth.role && allowedRoles.includes(auth.role as PortalRole)) {
    return <Outlet />;
  }

  return <Navigate replace to="/forbidden" />;
}

