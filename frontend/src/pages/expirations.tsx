import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Mail, Phone, RefreshCw, Square } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/state';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LicenseStatusBadge, PaymentStatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { daysRemainingLabel, formatDate, formatMoney, formatNumber } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import type { LicenseStatus, PaymentStatus } from '@/types';

type Filter = 'today' | '7d' | '30d' | 'expired' | 'grace';

interface ExpiringRow {
  id: number;
  licenseKey: string;
  expiresAt: string | null;
  status: LicenseStatus;
  customer: { id: number; name: string; company: string | null; email: string; phone?: string | null };
  plan: { id: number; name: string; nameAr: string | null };
  subscription: {
    id: number;
    status: string;
    payments: Array<{ id: number; status: PaymentStatus; paidAt: string | null; amount: number }>;
  } | null;
  activeDevices: number;
}

const FILTERS: Array<{ value: Filter; label: string; description: string }> = [
  { value: 'today', label: 'ينتهي اليوم', description: 'تراخيص تنتهي خلال 24 ساعة' },
  { value: '7d', label: 'خلال 7 أيام', description: 'أنصح بتجديدها الآن' },
  { value: '30d', label: 'خلال 30 يوم', description: 'للتخطيط المسبق' },
  { value: 'grace', label: 'فترة السماح', description: 'منتهية لكن ضمن المهلة' },
  { value: 'expired', label: 'منتهية تمامًا', description: 'خارج فترة السماح — لا تعمل' },
];

export function ExpirationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [filter, setFilter] = useState<Filter>('7d');

  const query = useQuery({
    queryKey: ['licenses', 'expiring', filter],
    queryFn: () =>
      api.get<{ data: ExpiringRow[]; meta: { count: number } }>('/licenses/expiring', { filter }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['licenses'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  };

  const renew = useMutation({
    mutationFn: (id: number) => api.post(`/licenses/${id}/renew`, { periods: 1 }),
    onSuccess: () => { invalidate(); toast.success('تم التجديد', 'حُدِّث تاريخ الانتهاء'); },
    onError: (error) => toast.error('تعذّر التجديد', (error as ApiError).friendlyMessage),
  });

  const suspend = useMutation({
    mutationFn: (id: number) =>
      api.post(`/licenses/${id}/suspend`, { reason: 'Expired — suspended from the expiry monitor' }),
    onSuccess: () => { invalidate(); toast.success('تم الإيقاف', 'الترخيص لم يعد يعمل'); },
    onError: (error) => toast.error('تعذّر الإيقاف', (error as ApiError).friendlyMessage),
  });

  const active = FILTERS.find((f) => f.value === filter);

  return (
    <div className="space-y-4">
      {confirmDialog}

      <header>
        <h1 className="text-xl font-bold">انتهاء الصلاحية</h1>
        <p className="text-sm text-muted-foreground">
          راجع التراخيص قبل انتهائها وحدّدها — مع كل حالة فترة السماح
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((entry) => (
          <Button
            key={entry.value}
            size="sm"
            variant={filter === entry.value ? 'default' : 'outline'}
            onClick={() => setFilter(entry.value)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{active?.label}</CardTitle>
          <CardDescription>
            {active?.description}
            {query.data && ` — ${formatNumber(query.data.meta.count)} ترخيص`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <TableSkeleton columns={7} />
          ) : query.isError ? (
            <ErrorState
              title="تعذّر تحميل البيانات"
              description={(query.error as ApiError).friendlyMessage}
              onRetry={() => query.refetch()}
            />
          ) : !query.data?.data.length ? (
            <EmptyState
              icon={CalendarClock}
              title="لا يوجد شيء في هذه الفئة"
              description="لا توجد تراخيص تحتاج متابعة الآن."
            />
          ) : (
            <ExpirationTable
              rows={query.data.data}
              canUpdate={can('licenses.update')}
              canSuspend={can('licenses.suspend')}
              onOpen={(id) => navigate(`/licenses/${id}`)}
              renew={renew}
              suspend={suspend}
              confirm={confirm}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}


function ExpirationTable({
  rows,
  canUpdate,
  canSuspend,
  onOpen,
  renew,
  suspend,
  confirm,
}: {
  rows: ExpiringRow[];
  canUpdate: boolean;
  canSuspend: boolean;
  onOpen: (id: number) => void;
  renew: { mutate: (id: number) => void; isPending: boolean; variables?: number };
  suspend: { mutate: (id: number) => void };
  confirm: (
    options: { title: string; description: string; confirmLabel?: string; variant?: 'default' | 'destructive' },
    onConfirm: () => void,
  ) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>العميل</TableHead>
          <TableHead>المفتاح</TableHead>
          <TableHead>الخطة</TableHead>
          <TableHead>الحالة</TableHead>
          <TableHead>الانتهاء</TableHead>
          <TableHead>آخر دفعة</TableHead>
          <TableHead>الأجهزة</TableHead>
          <TableHead>إجراءات</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const payment = row.subscription?.payments?.[0] ?? null;
          const daysLeft = row.expiresAt
            ? Math.max(0, Math.floor((new Date(row.expiresAt).getTime() - Date.now()) / 86_400_000))
            : null;

          return (
            <TableRow key={row.id} className="cursor-pointer" onClick={() => onOpen(row.id)}>
              <TableCell>
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.customer.company || row.customer.name}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="ltr flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {row.customer.email}
                    </span>
                    {row.customer.phone && (
                      <span className="ltr flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {row.customer.phone}
                      </span>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="ltr font-mono text-xs">{row.licenseKey}</TableCell>
              <TableCell className="text-sm">{row.plan.nameAr || row.plan.name}</TableCell>
              <TableCell><LicenseStatusBadge value={row.status} /></TableCell>
              <TableCell>
                <div>
                  <p className="text-sm">{formatDate(row.expiresAt)}</p>
                  <p className="text-xs text-muted-foreground">{daysRemainingLabel(daysLeft)}</p>
                </div>
              </TableCell>
              <TableCell>
                {payment ? (
                  <div>
                    <p className="text-sm">{formatMoney(payment.amount)}</p>
                    <PaymentStatusBadge value={payment.status} />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">لا يوجد</span>
                )}
              </TableCell>
              <TableCell><Badge variant="secondary">{row.activeDevices}</Badge></TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>
                <div className="flex gap-1.5">
                  {canUpdate && row.status !== 'REVOKED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      isLoading={renew.isPending && renew.variables === row.id}
                      onClick={() => renew.mutate(row.id)}
                    >
                      <RefreshCw />
                      تجديد
                    </Button>
                  )}
                  {canSuspend && row.status !== 'SUSPENDED' && row.status !== 'REVOKED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        confirm(
                          {
                            title: 'إيقاف الترخيص',
                            description: `سيتوقف الترخيص الخاص بـ ${row.customer.company || row.customer.name} فورًا.`,
                            confirmLabel: 'إيقاف',
                            variant: 'destructive',
                          },
                          () => suspend.mutate(row.id),
                        )
                      }
                    >
                      <Square />
                      إيقاف
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
