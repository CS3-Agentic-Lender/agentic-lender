import type { RouteObject } from 'react-router';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PortalPage } from './pages/PortalPage';

export const appRoutes: RouteObject[] = [
  { path: '/', element: <LoginPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/portal', element: <PortalPage /> },
  { path: '*', element: <NotFoundPage /> },
];
