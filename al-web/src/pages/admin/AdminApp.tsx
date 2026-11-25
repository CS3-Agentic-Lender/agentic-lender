import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import { Route, Routes } from 'react-router';
import { ToastProvider } from '../../components/admin/Toasts';
import { StaffProvider } from '../../context/StaffContext';
import { NotFoundPage } from '../NotFoundPage';
import { LoanFilePage } from '../shared/LoanFilePage';
import { AdminDashboardPage } from './AdminDashboardPage';
import { InboxPage } from './InboxPage';
import { AiRunsPage } from './business/AiRunsPage';
import { ApplicationsPage } from './business/ApplicationsPage';
import { AuditPage } from './business/AuditPage';
import { OverviewPage } from './business/OverviewPage';
import { UsersPage } from './business/UsersPage';
import { StaffPage } from './StaffPage';

// Everything under /admin, loaded as its own chunk so brokers and underwriters never download it.
// Motion honours the reduced-motion setting, like the portal's CSS animations. Only its small DOM
// animation features load (`m` components, strict), which keeps this chunk light.
export function AdminApp() {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <StaffProvider>
        <ToastProvider>
          <Routes>
            <Route element={<AdminDashboardPage />} index />
            <Route element={<StaffPage />} path="staff" />
            <Route element={<InboxPage />} path="inbox" />
            <Route element={<OverviewPage />} path="business" />
            <Route element={<ApplicationsPage />} path="business/applications" />
            <Route element={<UsersPage />} path="business/users" />
            <Route element={<AiRunsPage />} path="business/ai-runs" />
            <Route element={<AuditPage />} path="business/audit" />
            <Route element={<LoanFilePage viewer="admin" />} path="applications/:applicationId" />
            <Route element={<NotFoundPage />} path="*" />
          </Routes>
        </ToastProvider>
        </StaffProvider>
      </MotionConfig>
    </LazyMotion>
  );
}
