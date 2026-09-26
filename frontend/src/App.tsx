import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '@/layouts/admin-layout';
import { ProtectedRoute } from '@/routes/protected-route';
import { AuthProvider } from '@/hooks/use-auth';
import { ToastProviderHost } from '@/hooks/use-toast';
import { CustomersPage } from '@/pages/customers';
import { CustomerDetailPage } from '@/pages/customer-detail';
import { DashboardPage } from '@/pages/dashboard';
import { LicensesPage } from '@/pages/licenses';
import { LicenseDetailPage } from '@/pages/license-detail';
import { LoginPage } from '@/pages/login';
import { NotFoundPage } from '@/pages/not-found';
import { PlansPage } from '@/pages/plans';
import { PlaceholderPage } from '@/pages/placeholder';

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

                  {/* Phase 2 modules — routes wired, screens land next. */}
                  <Route path="subscriptions" element={<PlaceholderPage title="الاشتراكات" phase="2" />} />
                  <Route path="devices" element={<PlaceholderPage title="الأجهزة" phase="2" />} />
                  <Route path="activations" element={<PlaceholderPage title="التفعيلات" phase="2" />} />
                  <Route path="expirations" element={<PlaceholderPage title="انتهاء الصلاحية" phase="2" />} />
                  <Route path="features" element={<PlaceholderPage title="الميزات" phase="2" />} />
                  <Route path="payments" element={<PlaceholderPage title="المدفوعات" phase="2" />} />
                  <Route path="support" element={<PlaceholderPage title="الدعم الفني" phase="2" />} />
                  <Route path="releases" element={<PlaceholderPage title="الإصدارات" phase="2" />} />
                  <Route path="analytics" element={<PlaceholderPage title="التقارير" phase="2" />} />
                  <Route path="audit-logs" element={<PlaceholderPage title="سجل التدقيق" phase="2" />} />
                  <Route path="settings" element={<PlaceholderPage title="الإعدادات" phase="2" />} />
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
