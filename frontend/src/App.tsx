import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '@/layouts/admin-layout';
import { ProtectedRoute } from '@/routes/protected-route';
import { AuthProvider } from '@/hooks/use-auth';
import { ToastProviderHost } from '@/hooks/use-toast';
import { AnalyticsPage } from '@/pages/analytics';
import { AuditLogsPage } from '@/pages/audit-logs';
import { CustomerDetailPage } from '@/pages/customer-detail';
import { CustomersPage } from '@/pages/customers';
import { DashboardPage } from '@/pages/dashboard';
import { DevicesPage } from '@/pages/devices';
import { LicenseDetailPage } from '@/pages/license-detail';
import { LicensesPage } from '@/pages/licenses';
import { LoginPage } from '@/pages/login';
import { NotFoundPage } from '@/pages/not-found';
import { PaymentsPage } from '@/pages/payments';
import { PlansPage } from '@/pages/plans';
import { ReleasesPage } from '@/pages/releases';
import { SettingsPage } from '@/pages/settings';
import { SubscriptionsPage } from '@/pages/subscriptions';
import { SupportPage } from '@/pages/support';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Panel data is operational: prefer a short cache, refetch on focus.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Never retry an authorisation or validation failure.
        const status = (error as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProviderHost>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />

              <Route element={<ProtectedRoute />}>
                <Route element={<AdminLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="customers" element={<CustomersPage />} />
                  <Route path="customers/:id" element={<CustomerDetailPage />} />
                  <Route path="plans" element={<PlansPage />} />
                  <Route path="licenses" element={<LicensesPage />} />
                  <Route path="licenses/:id" element={<LicenseDetailPage />} />
                  <Route path="subscriptions" element={<SubscriptionsPage />} />
                  <Route path="devices" element={<DevicesPage />} />
                  <Route path="payments" element={<PaymentsPage />} />
                  <Route path="support" element={<SupportPage />} />
                  <Route path="releases" element={<ReleasesPage />} />
                  <Route path="analytics" element={<AnalyticsPage />} />
                  <Route path="audit-logs" element={<AuditLogsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>

              <Route path="/404" element={<NotFoundPage />} />
              <Route path="*" element={<Navigate to="/404" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProviderHost>
    </QueryClientProvider>
  );
}
