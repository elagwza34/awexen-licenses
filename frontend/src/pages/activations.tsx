import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CountCard, StatCard } from '@/components/stat-card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/state';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ValidationStatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/utils';
import type { Paginated, ValidationStatus } from '@/types';

interface ValidationRow {
  id: number;
  status: ValidationStatus;
  reason: string | null;
  appVersion: string | null;
  ip: string | null;
  createdAt: string;
  license: { id: number; licenseKey: string };
  customer: { id: number; name: string; company: string | null };
  device: { id: number; deviceName: string | null } | null;
}

interface ActivationRow {
  id: number;
  activationType: string;
  success: boolean;
  failureReason: string | null;
  ip: string | null;
  createdAt: string;
  license: { id: number; licenseKey: string };
  device: { id: number; deviceName: string | null } | null;
}

interface HealthResponse {
  data: Array<{ status: ValidationStatus; count: number }>;
  meta: { total: number; success: number; failureRate: number; windowDays: number };
}

const ACTIVATION_LABELS: Record<string, string> = {
  INITIAL: 'تفعيل أول', REACTIVATION: 'إعادة تفعيل',
  RENEWAL: 'تجديد', DEVICE_RESET: 'إعادة تعيين جهاز',
};

const HEALTH_LABELS: Record<string, string> = {
  SUCCESS: 'ناجحة', FAILED: 'فاشلة', EXPIRED: 'منتهية', SUSPENDED: 'موقوفة',
  INVALID: 'غير صالحة', DEVICE_LIMIT: 'تجاوز حد الأجهزة', REVOKED: 'ملغاة',
};

const PAGE_SIZE = 25;

export function ActivationsPage() {
  const [tab, setTab] = useState('validations');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const validations = useQuery({
    queryKey: ['validations', { page, status }],
    queryFn: () =>
      api.get<Paginated<ValidationRow>>('/validations/history', {
        page, limit: PAGE_SIZE, status: status || undefined,
      }),
  });

  const activations = useQuery({
    queryKey: ['activations', page],
    queryFn: () => api.get<Paginated<ActivationRow>>('/validations/activations', { page, limit: PAGE_SIZE }),
  });

  const health = useQuery({
    queryKey: ['validations', 'health'],
    queryFn: () => api.get<HealthResponse>('/validations/health', { days: 30 }),
  });

  const meta = health.data?.meta;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">التفعيلات والتحققات</h1>
        <p className="text-sm text-muted-foreground">
          كل محاولة تفعيل أو تحقق من تطبيق العميل — أهم مؤشر لصحة الترخيص
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard title="إجمالي التحققات" count={meta?.total} icon={Activity} loading={health.isLoading} />
        <CountCard title="ناجحة" count={meta?.success} icon={CheckCircle2} tone="success" loading={health.isLoading} />
        <StatCard
          title="نسبة الفشل"
          value={meta ? `${meta.failureRate}%` : undefined}
          hint={meta ? `آخر ${meta.windowDays} يوم` : undefined}
          icon={XCircle}
          tone="destructive"
          loading={health.isLoading}
        />
        <CountCard
          title="تجاوزوا حد الأجهزة"
          count={health.data?.data.find((h) => h.status === 'DEVICE_LIMIT')?.count}
          icon={Activity}
          tone="warning"
          loading={health.isLoading}
        />
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="validations">التحققات</TabsTrigger>
          <TabsTrigger value="activations">التفعيلات</TabsTrigger>
          <TabsTrigger value="health">التوزيع</TabsTrigger>
        </TabsList>

        <TabsContent value="validations">
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Button size="sm" variant={status === '' ? 'default' : 'outline'} onClick={() => { setStatus(''); setPage(1); }}>
              الكل
            </Button>
            {Object.entries(HEALTH_LABELS).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={status === value ? 'default' : 'outline'}
                onClick={() => { setStatus(value); setPage(1); }}
              >
                {label}
              </Button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              {validations.isLoading ? (
                <TableSkeleton columns={6} />
              ) : validations.isError ? (
                <ErrorState
                  title="تعذّر تحميل السجل"
                  description={(validations.error as ApiError)?.friendlyMessage}
                  onRetry={() => validations.refetch()}
                />
              ) : !validations.data?.data.length ? (
                <EmptyState title="لا توجد تحققات" description="لم يتصل أي عميل بعد." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>العميل</TableHead>
                      <TableHead>المفتاح</TableHead>
                      <TableHead>الجهاز</TableHead>
                      <TableHead>النتيجة</TableHead>
                      <TableHead>إصدار التطبيق</TableHead>
                      <TableHead>التوقيت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validations.data.data.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm">
                          {row.customer.company || row.customer.name}
                        </TableCell>
                        <TableCell className="ltr font-mono text-xs">{row.license.licenseKey}</TableCell>
                        <TableCell className="text-sm">{row.device?.deviceName ?? '—'}</TableCell>
                        <TableCell>
                          <ValidationStatusBadge value={row.status} />
                        </TableCell>
                        <TableCell className="ltr text-xs">{row.appVersion ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {relativeTime(row.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Pager
            page={validations.data?.meta.page ?? 1}
            totalPages={validations.data?.meta.totalPages ?? 1}
            total={validations.data?.meta.total ?? 0}
            onPageChange={setPage}
          />
        </TabsContent>

        <TabsContent value="activations">
          <Card>
            <CardHeader>
              <CardTitle>سجل التفعيلات</CardTitle>
              <CardDescription>تفعيل أول، إعادة تفعيل، تجديد، وإعادة تعيين أجهزة</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {activations.isLoading ? (
                <TableSkeleton columns={5} />
              ) : activations.isError ? (
                <ErrorState
                  title="تعذّر تحميل السجل"
                  description={(activations.error as ApiError)?.friendlyMessage}
                  onRetry={() => activations.refetch()}
                />
              ) : !activations.data?.data.length ? (
                <EmptyState title="لا توجد تفعيلات" description="لم يُفعَّل أي ترخيص بعد." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المفتاح</TableHead>
                      <TableHead>الجهاز</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>النتيجة</TableHead>
                      <TableHead>التوقيت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activations.data.data.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="ltr font-mono text-xs">{row.license.licenseKey}</TableCell>
                        <TableCell className="text-sm">{row.device?.deviceName ?? '—'}</TableCell>
                        <TableCell className="text-sm">
                          {ACTIVATION_LABELS[row.activationType] ?? row.activationType}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.success ? 'success' : 'destructive'}>
                            {row.success ? 'نجح' : row.failureReason ?? 'فشل'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(row.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Pager
            page={activations.data?.meta.page ?? 1}
            totalPages={activations.data?.meta.totalPages ?? 1}
            total={activations.data?.meta.total ?? 0}
            onPageChange={setPage}
          />
        </TabsContent>

        <TabsContent value="health">
          <Card>
            <CardHeader>
              <CardTitle>توزيع نتائج التحقق</CardTitle>
              <CardDescription>آخر 30 يومًا</CardDescription>
            </CardHeader>
            <CardContent>
              {!health.data?.data.length ? (
                <EmptyState title="لا توجد بيانات" />
              ) : (
                <div className="space-y-2">
                  {health.data.data.map((entry) => {
                    const pct = health.data!.meta.total
                      ? Math.round((entry.count / health.data!.meta.total) * 100)
                      : 0;
                    return (
                      <div key={entry.status} className="flex items-center gap-3">
                        <span className="w-32 shrink-0 text-sm">
                          {HEALTH_LABELS[entry.status] ?? entry.status}
                        </span>
                        <div className="h-2 flex-1 rounded-full bg-muted">
                          <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-20 shrink-0 text-end text-xs text-muted-foreground">
                          {entry.count} ({pct}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Pager({
  page, totalPages, total, onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <p className="text-muted-foreground">إجمالي {total} سجل</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          السابق
        </Button>
        <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          التالي
        </Button>
      </div>
    </div>
  );
}


