import { Navigate, Outlet, useRoutes, type RouteObject } from 'react-router';
import { RequireRole } from './components/auth/RequireRole';
import { BrokerClientsProvider } from './context/BrokerClientsContext';
import { PipelineProvider } from './context/PipelineContext';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PortalPage } from './pages/PortalPage';
import { LoanFilePage } from './pages/shared/LoanFilePage';
import { ClientDetailPage } from './pages/broker/ClientDetailPage';
import { ClientsPage } from './pages/broker/ClientsPage';
import { PipelinePage } from './pages/underwriter/PipelinePage';

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
      { path: '/broker/applications/:applicationId', element: <LoanFilePage viewer="broker" /> },
    ],
  },
  {
    element: <RequireRole allowedRoles={['underwriter']} />,
    children: [
      { path: '/underwriter', element: <PortalPage role="underwriter" /> },
      {
        path: '/underwriter/pipeline',
        element: (
          <PipelineProvider>
            <PipelinePage />
          </PipelineProvider>
        ),
      },
      { path: '/underwriter/applications/:applicationId', element: <LoanFilePage viewer="underwriter" /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export function AppRoutes() {
  return useRoutes(appRoutes);
}
