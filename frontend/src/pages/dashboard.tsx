import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  CalendarClock,
  CreditCard,
  KeyRound,
  Monitor,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/state';
import { Badge } from '@/components/ui/badge';
import { CountCard, StatCard } from '@/components/stat-card';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/utils';
import type { DashboardOverview, TimeSeriesPoint } from '@/types';

interface ExpiringRow {
  id: number;
  licenseKey: string;
  expiresAt: string | null;
  customer: { name: string; company: string | null };
  plan: { name: string; nameAr: string | null };
}

export function DashboardPage() {
  const overview = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => api.get<DashboardOverview>('/analytics/overview'),
  });

  const timeseries = useQuery({
    queryKey: ['analytics', 'timeseries'],
    queryFn: () =>
      api.get<{ data: TimeSeriesPoint[]; currency: string }>('/analytics/timeseries', { months: 12 }),
  });

  const expiring = useQuery({
    queryKey: ['licenses', 'expiring', '7d'],
    queryFn: () => api.get<{ data: ExpiringRow[] }>('/licenses/expiring', { filter: '7d' }),
  });

  const data = overview.data;
  const currency = data?.currency ?? 'EGP';
  const loading = overview.isLoading;
  const failed = overview.isError;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">لوحة التحكم</h1>
          <p className="text-sm text-muted-foreground">نظرة عامة على التراخيص والاشتراكات والإيرادات</p>
        </div>
        {overview.isFetching && !overview.isLoading && (
          <span className="text-xs text-muted-foreground">جارٍ التحديث…</span>
        )}
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="الإيراد الشهري المتكرر"
          value={data ? formatMoney(data.revenue.mrr, currency) : undefined}
          hint={data ? `سنوي: ${formatMoney(data.revenue.arr, currency)}` : undefined}
          icon={TrendingUp}
          loading={loading}
          error={failed}
        />
        <StatCard
          title="إيراد اليوم"
          value={data ? formatMoney(data.payments.todayRevenue, currency) : undefined}
          hint={data ? `${formatNumber(data.payments.todayRevenueCount)} عملية` : undefined}
          icon={CreditCard}
          loading={loading}
          error={failed}
        />
        <StatCard
          title="العملاء"
          value={data ? formatNumber(data.customers.total) : undefined}
          hint={
            data
              ? `${formatNumber(data.customers.active)} نشط · ${formatNumber(data.customers.trial)} تجريبي`
              : undefined
          }
          icon={Users}
          loading={loading}
          error={failed}
          to="/customers"
        />
        <StatCard
          title="التراخيص النشطة"
          value={data ? formatNumber(data.licenses.active) : undefined}
          hint={data ? `${formatNumber(data.devices.active)} جهاز نشط` : undefined}
          icon={KeyRound}
          loading={loading}
          error={failed}
          to="/licenses"
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard
          title="قارب على الانتهاء"
          count={data?.licenses.expiring}
          icon={CalendarClock}
          loading={loading}
          error={failed}
          to="/expirations"
          tone="warning"
        />
        <CountCard
          title="منتهي"
          count={data?.licenses.expired}
          icon={AlertOctagon}
          loading={loading}
          error={failed}
          to="/expirations"
          tone="destructive"
        />
        <CountCard
          title="موقوف"
          count={data?.licenses.suspended}
          icon={AlertOctagon}
          loading={loading}
          error={failed}
          to="/licenses"
          tone="destructive"
        />
        <CountCard
          title="أجهزة نشطة"
          count={data?.devices.active}
          icon={Monitor}
          loading={loading}
          error={failed}
          to="/devices"
        />
      </section>

      <RevenueChart
        data={timeseries.data?.data}
        currency={currency}
        loading={timeseries.isLoading}
        error={timeseries.isError ? (timeseries.error as ApiError)?.friendlyMessage : undefined}
      />

      <ExpiringSoon
        data={expiring.data?.data}
        loading={expiring.isLoading}
        error={expiring.isError ? (expiring.error as ApiError)?.friendlyMessage : undefined}
      />
    </div>
  );
}

function RevenueChart({
  data,
  currency,
  loading,
  error,
}: {
  data?: TimeSeriesPoint[];
  currency: string;
  loading: boolean;
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>الإيرادات</CardTitle>
        <CardDescription>آخر 12 شهرًا — أرقام حقيقية من قاعدة البيانات</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : error ? (
          <p className="py-12 text-center text-sm text-destructive">{error}</p>
        ) : !data || data.every((point) => point.revenue === 0) ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            لا توجد إيرادات مسجّلة بعد. سيظهر الرسم تلقائيًا بعد أول دفعة.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={288}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={60} />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number) => [formatMoney(value, currency), 'الإيراد']}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#revenueFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ExpiringSoon({
  data,
  loading,
  error,
}: {
  data?: ExpiringRow[];
  loading: boolean;
  error?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>تراخيص تنتهي خلال 7 أيام</CardTitle>
          <CardDescription>راجعها وجدّدها قبل انتهاء الصلاحية</CardDescription>
        </div>
        <Link
          to="/expirations"
          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
        >
          عرض الكل
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : !data?.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">لا توجد تراخيص تنتهي خلال 7 أيام.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.slice(0, 8).map((license) => (
              <li key={license.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <Link
                    to={`/licenses/${license.id}`}
                    className="truncate text-sm font-medium hover:text-primary"
                  >
                    {license.customer.company || license.customer.name}
                  </Link>
                  <p className="ltr truncate text-xs text-muted-foreground">{license.licenseKey}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{license.plan.nameAr || license.plan.name}</span>
                  <Badge variant="warning">{formatDateTime(license.expiresAt)}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
