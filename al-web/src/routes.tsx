import { Navigate, Outlet, useRoutes, type RouteObject } from 'react-router';
import { RequireRole } from './components/auth/RequireRole';
import { BrokerClientsProvider } from './context/BrokerClientsContext';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PortalPage } from './pages/PortalPage';
import { ClientDetailPage } from './pages/broker/ClientDetailPage';
import { ClientsPage } from './pages/broker/ClientsPage';

export const appRoutes: RouteObject[] = [
  { path: '/', element: <Navigate replace to="/login" /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/forbidden', element: <ForbiddenPage /> },
  {
    element: <RequireRole allowedRoles={['broker']} />,
    children: [
      { path: '/broker', element: <PortalPage role="broker" /> },
      {
        element: (
          <BrokerClientsProvider>
            <Outlet />
          </BrokerClientsProvider>
        ),
        children: [
          { path: '/broker/clients', element: <ClientsPage /> },
          { path: '/broker/clients/:clientId', element: <ClientDetailPage /> },
        ],
      },
    ],
  },
  {
    element: <RequireRole allowedRoles={['underwriter']} />,
    children: [{ path: '/underwriter', element: <PortalPage role="underwriter" /> }],
  },
  { path: '*', element: <NotFoundPage /> },
];

export function AppRoutes() {
  return useRoutes(appRoutes);
}
