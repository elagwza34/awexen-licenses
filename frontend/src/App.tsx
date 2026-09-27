import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '@/layouts/admin-layout';
import { ProtectedRoute } from '@/routes/protected-route';
import { AuthProvider } from '@/hooks/use-auth';
import { ToastProviderHost } from '@/hooks/use-toast';
import { AnalyticsPage } from '@/pages/analytics';
import { AuditLogsPage } from '@/pages/audit-logs';
import { ActivationsPage } from '@/pages/activations';
import { CustomerDetailPage } from '@/pages/customer-detail';
import { CustomersPage } from '@/pages/customers';
import { DashboardPage } from '@/pages/dashboard';
import { DevicesPage } from '@/pages/devices';
import { ExpirationsPage } from '@/pages/expirations';
import { FeaturesPage } from '@/pages/features';
import { LicenseDetailPage } from '@/pages/license-detail';
import { LicensesPage } from '@/pages/licenses';
import { CustomerRegisterPage } from '@/pages/customer-register';
import { PortalLoginPage } from '@/pages/portal-login';
import { PortalOverviewPage } from '@/pages/portal-overview';
import { PortalLicensesPage } from '@/pages/portal-licenses';
import { PortalSubscriptionPage } from '@/pages/portal-subscription';
import { PortalRequestsPage } from '@/pages/portal-requests';
import { PortalDownloadPage } from '@/pages/portal-download';
import { PortalAccountPage } from '@/pages/portal-account';
import { PortalLayout } from '@/layouts/portal-layout';
import { PortalRoute } from '@/routes/portal-route';
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
              {/* Customer self-service. Public by design: this is how a
                  customer creates the account the owner then finds in the
                  panel. The download itself stays behind the payment gate. */}
              <Route path="/portal/register" element={<CustomerRegisterPage />} />

              {/* The customer portal. Kept outside ProtectedRoute on purpose —
                  that guard is for the owner's admin token, and a customer
                  must never satisfy it. PortalRoute checks the customer token
                  instead and sends them to the sign-in page, not the admin
                  one, so a lost session never lands a customer in the panel. */}
              <Route path="/portal/login" element={<PortalLoginPage />} />
              <Route element={<PortalRoute />}>
                <Route element={<PortalLayout />}>
                  <Route path="/portal" element={<PortalOverviewPage />} />
                  <Route path="/portal/licenses" element={<PortalLicensesPage />} />
                  <Route path="/portal/subscription" element={<PortalSubscriptionPage />} />
                  <Route path="/portal/requests" element={<PortalRequestsPage />} />
                  <Route path="/portal/download" element={<PortalDownloadPage />} />
                  <Route path="/portal/account" element={<PortalAccountPage />} />
                </Route>
              </Route>

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
                  <Route path="activations" element={<ActivationsPage />} />
                  <Route path="expirations" element={<ExpirationsPage />} />
                  <Route path="features" element={<FeaturesPage />} />
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
