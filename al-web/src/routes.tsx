import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { Navigate, Outlet, useRoutes, type RouteObject } from 'react-router';
import { PageSkeleton } from './components/PageSkeleton';
import { PortalHeader } from './components/PortalHeader';
import { Skeleton } from './components/Skeleton';
import { RequireRole } from './components/auth/RequireRole';
import { BrokerClientsProvider } from './context/BrokerClientsContext';
import { PipelineProvider } from './context/PipelineContext';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PortalPage } from './pages/PortalPage';
import { LoanFileSkeleton } from './pages/shared/LoanFileSkeleton';

// The data pages are their own chunks, so the sign-in screen and the portal frame do not wait for every page's
// code. They are fetched as soon as the browser is idle, so opening a page rarely waits; if it does, its route
// shows the page's shape in placeholders.
function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  const preload = () => load().then((component) => { loaded = component; });
  const Page = lazy(() => {
    if (loaded) {
      const component = loaded;
      // A thenable that answers at once: lazy() then renders the preloaded page in the same pass instead of
      // suspending, which would hold the page back behind React's fallback throttle (300 ms).
      return { then: (resolve: (module: { default: ComponentType<P> }) => void) => resolve({ default: component }) } as unknown as Promise<{ default: ComponentType<P> }>;
    }
    return load().then((component) => ({ default: component }));
  });
  return { Page, preload };
}

const loanFile = lazyPage(() => import('./pages/shared/LoanFilePage').then((module) => module.LoanFilePage));
const clientDetail = lazyPage(() => import('./pages/broker/ClientDetailPage').then((module) => module.ClientDetailPage));
const clients = lazyPage(() => import('./pages/broker/ClientsPage').then((module) => module.ClientsPage));
const messages = lazyPage(() => import('./pages/broker/MessagesPage').then((module) => module.MessagesPage));
const pipeline = lazyPage(() => import('./pages/underwriter/PipelinePage').then((module) => module.PipelinePage));
const rateShock = lazyPage(() => import('./pages/underwriter/RateShockPage').then((module) => module.RateShockPage));
const { Page: LoanFilePage } = loanFile;
const { Page: ClientDetailPage } = clientDetail;
const { Page: ClientsPage } = clients;
const { Page: MessagesPage } = messages;
const { Page: PipelinePage } = pipeline;
const { Page: RateShockPage } = rateShock;

function usePrefetchPages() {
  useEffect(() => {
    const prefetch = () => {
      for (const { preload } of [loanFile, clientDetail, clients, messages, pipeline, rateShock]) void preload().catch(() => {});
    };
    // Older Safari has no requestIdleCallback.
    if (typeof (window as Partial<Window>).requestIdleCallback !== 'function') {
      const timer = window.setTimeout(prefetch, 1500);
      return () => window.clearTimeout(timer);
    }
    const idle = window.requestIdleCallback(prefetch, { timeout: 3000 });
    return () => window.cancelIdleCallback(idle);
  }, []);
}

function Page({ label, children }: { label: string; children: ReactNode }) {
  return <Suspense fallback={<PageSkeleton header={<PortalHeader />} label={label} />}>{children}</Suspense>;
}

// The loan file's back link and body, with the loan file page's own spacing.
function LoanFileRoute({ children }: { children: ReactNode }) {
  const fallback = (
    <PageSkeleton header={<PortalHeader />} label="Loading the loan file" mainClassName="px-4 pt-6 pb-16 sm:px-6 sm:pt-8">
      <Skeleton className="h-6 w-48" />
      <div className="mt-6">
        <LoanFileSkeleton />
      </div>
    </PageSkeleton>
  );
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

const AdminApp = lazy(() => import('./pages/admin/AdminApp'));

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
          { path: '/broker/clients', element: <Page label="Loading your clients"><ClientsPage /></Page> },
          { path: '/broker/clients/:clientId', element: <Page label="Loading the client file"><ClientDetailPage /></Page> },
          { path: '/broker/messages', element: <Page label="Loading your messages"><MessagesPage /></Page> },
        ],
      },
      {
        path: '/broker/applications/:applicationId',
        element: <LoanFileRoute><LoanFilePage viewer="broker" /></LoanFileRoute>,
      },
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
            <Page label="Loading the pipeline"><PipelinePage /></Page>
          </PipelineProvider>
        ),
      },
      { path: '/underwriter/stress', element: <Page label="Loading the stress test"><RateShockPage /></Page> },
      {
        path: '/underwriter/applications/:applicationId',
        element: <LoanFileRoute><LoanFilePage viewer="underwriter" /></LoanFileRoute>,
      },
    ],
  },
  {
    element: <RequireRole allowedRoles={['admin']} />,
    children: [
      {
        path: '/admin/*',
        element: (
          <Suspense
            fallback={
              <PageSkeleton
                header={<PortalHeader />}
                label="Loading the admin portal"
                mainClassName="px-4 py-10 sm:px-6 sm:py-12"
              />
            }
          >
            <AdminApp />
          </Suspense>
        ),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export function AppRoutes() {
  usePrefetchPages();
  return useRoutes(appRoutes);
}
