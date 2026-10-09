import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import type { PortalRole } from '../../services/authService';
import { AuthLoadingPage } from './AuthLoadingPage';

interface RequireRoleProps {
  allowedRoles: readonly PortalRole[];
}

export function RequireRole({ allowedRoles }: RequireRoleProps) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return <AuthLoadingPage />;
  }

  if (auth.status === 'anonymous') {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }

  if (auth.status === 'authenticated' && auth.role && allowedRoles.includes(auth.role as PortalRole)) {
    return <Outlet />;
  }

  return <Navigate replace to="/forbidden" />;
}

