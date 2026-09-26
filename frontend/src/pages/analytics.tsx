import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CountCard, StatCard } from '@/components/stat-card';
import { ErrorCard, Skeleton } from '@/components/state';
import { CreditCard, KeyRound, TrendingUp, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import type { DashboardOverview, LicenseStatus, TimeSeriesPoint } from '@/types';

interface ChurnPoint { month: string; churned: number; rate: number; }
interface PlanPoint { id: number; name: string; nameAr: string | null; subscriptions: number; licenses: number; }
interface HealthPoint { status: LicenseStatus; count: number; }

const PIE_COLOURS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

export function AnalyticsPage() {
  const overview = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => api.get<DashboardOverview>('/analytics/overview'),
  });
  const series = useQuery({
    queryKey: ['analytics', 'timeseries'],
    queryFn: () => api.get<{ data: TimeSeriesPoint[] }>('/analytics/timeseries', { months: 12 }),
  });
  const churn = useQuery({
    queryKey: ['analytics', 'churn'],
    queryFn: () => api.get<{ data: ChurnPoint[] }>('/analytics/churn', { months: 6 }),
  });
  const plans = useQuery({
    queryKey: ['analytics', 'plans'],
    queryFn: () => api.get<{ data: PlanPoint[] }>('/analytics/plan-distribution'),
  });
  const health = useQuery({
    queryKey: ['analytics', 'health'],
    queryFn: () => api.get<{ data: HealthPoint[] }>('/analytics/license-health'),
  });

  const o = overview.data;
  const currency = o?.currency ?? 'EGP';
  const loading = overview.isLoading;
  const failed = overview.isError;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">التقارير</h1>
        <p className="text-sm text-muted-foreground">كل الأرقام محسوبة من قاعدة البيانات مباشرة</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="الإيراد الشهري"
          value={o ? formatMoney(o.revenue.mrr, currency) : undefined}
          hint={o ? `سنوي ${formatMoney(o.revenue.arr, currency)}` : undefined}
          icon={TrendingUp} loading={loading} error={failed}
        />
        <StatCard
          title="إيراد اليوم"
          value={o ? formatMoney(o.payments.todayRevenue, currency) : undefined}
          icon={CreditCard} loading={loading} error={failed}
        />
        <CountCard title="العملاء" count={o?.customers.total} icon={Users} loading={loading} error={failed} />
        <CountCard title="تراخيص نشطة" count={o?.licenses.active} icon={KeyRound} loading={loading} error={failed} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الإيرادات الشهرية</CardTitle>
            <CardDescription>آخر 12 شهرًا</CardDescription>
          </CardHeader>
          <CardContent>
            {series.isLoading ? <Skeleton className="h-64 w-full" /> : (
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={series.data?.data}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} />
                  <Tooltip formatter={(v: number) => formatMoney(v, currency)} />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>حالة التراخيص</CardTitle>
            <CardDescription>توزيع التراخيص على الحالات</CardDescription>
          </CardHeader>
          <CardContent>
            {health.isLoading ? <Skeleton className="h-64 w-full" /> : !health.data?.data.length ? (
              <p className="py-16 text-center text-sm text-muted-foreground">لا توجد تراخيص بعد.</p>
            ) : (
              <ResponsiveContainer width="100%" height={256}>
                <PieChart>
                  <Pie data={health.data.data} dataKey="count" nameKey="status" outerRadius={80}>
                    {health.data.data.map((entry, index) => (
                      <Cell key={entry.status} fill={PIE_COLOURS[index % PIE_COLOURS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>


        <Card>
          <CardHeader>
            <CardTitle>العملاء الجدد والتفعيلات</CardTitle>
            <CardDescription>نشاط آخر 12 شهرًا</CardDescription>
          </CardHeader>
          <CardContent>
            {series.isLoading ? <Skeleton className="h-64 w-full" /> : (
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={series.data?.data}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="newCustomers" name="عملاء جدد" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="activations" name="تفعيلات" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الاشتراكات لكل خطة</CardTitle>
            <CardDescription>توزيع العملاء على الباقات</CardDescription>
          </CardHeader>
          <CardContent>
            {plans.isLoading ? <Skeleton className="h-64 w-full" /> : !plans.data?.data.length ? (
              <p className="py-16 text-center text-sm text-muted-foreground">لا توجد خطط.</p>
            ) : (
              <div className="space-y-2">
                {plans.data.data.map((plan) => (
                  <div key={plan.id} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{plan.nameAr || plan.name}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {plan.subscriptions} اشتراك
                      </span>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">{plan.licenses} ترخيص</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الاحتفاظ بالعملاء (Churn)</CardTitle>
          <CardDescription>نسبة الاشتراكات المنتهية شهريًا</CardDescription>
        </CardHeader>
        <CardContent>
          {churn.isLoading ? <Skeleton className="h-40 w-full" /> : churn.isError ? (
            <ErrorCard message="تعذّر تحميل بيانات الاحتفاظ" onRetry={() => churn.refetch()} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {churn.data?.data.map((point) => (
                <div key={point.month} className="rounded-md border border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground">{point.month}</p>
                  <p className="text-lg font-bold">{point.rate}%</p>
                  <p className="text-[11px] text-muted-foreground">{point.churned} منتهية</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
