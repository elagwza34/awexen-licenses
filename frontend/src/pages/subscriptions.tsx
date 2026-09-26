import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { BillingIntervalBadge, SubscriptionStatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { daysRemainingLabel, formatDate, formatMoney } from '@/lib/utils';
import type { Paginated, Subscription, SubscriptionStatus } from '@/types';

const PAGE_SIZE = 20;

const STATUS_FILTERS: Array<{ value: SubscriptionStatus | ''; label: string }> = [
  { value: '', label: 'الكل' },
  { value: 'ACTIVE', label: 'نشط' },
  { value: 'TRIAL', label: 'تجريبي' },
  { value: 'PAST_DUE', label: 'متأخر السداد' },
  { value: 'EXPIRED', label: 'منتهي' },
  { value: 'SUSPENDED', label: 'موقوف' },
  { value: 'CANCELLED', label: 'ملغى' },
];

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'نشط', TRIAL: 'تجريبي', PAST_DUE: 'متأخر', EXPIRED: 'منتهي',
  SUSPENDED: 'موقوف', CANCELLED: 'ملغى', OPEN: 'مفتوح', IN_PROGRESS: 'قيد المعالجة',
  WAITING_CUSTOMER: 'بانتظار العميل', RESOLVED: 'تم الحل', CLOSED: 'مغلق',
};

const PRIORITY_VARIANTS: Record<string, 'muted' | 'secondary' | 'warning' | 'destructive'> = {
  LOW: 'muted', MEDIUM: 'secondary', HIGH: 'warning', URGENT: 'destructive',
};

export function SubscriptionsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus | ''>('');

  const query = useQuery({
    queryKey: ['subscriptions', { page, search, status }],
    queryFn: () =>
      api.get<Paginated<Subscription>>('/subscriptions', {
        page, limit: PAGE_SIZE, search: search || undefined, status: status || undefined,
      }),
  });

  const columns: Column<Subscription>[] = [
    {
      key: 'customer',
      header: 'العميل',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.customer?.company || row.customer?.name || '—'}</p>
          <p className="ltr truncate text-xs text-muted-foreground">{row.customer?.email}</p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'الخطة',
      cell: (row) => (
        <div className="space-y-1">
          <p className="text-sm">{row.plan?.nameAr || row.plan?.name || '—'}</p>
          <BillingIntervalBadge value={row.billingInterval} />
        </div>
      ),
    },
    {
      key: 'price',
      header: 'السعر',
      cell: (row) => <span className="text-sm">{formatMoney(row.price, row.currency)}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (row) => <SubscriptionStatusBadge value={row.status} showCode />,
    },
    {
      key: 'expires',
      header: 'الانتهاء',
      cell: (row) => (
        <div className="min-w-0">
          <p className="text-sm">{formatDate(row.expiresAt)}</p>
          <p className="text-xs text-muted-foreground">{daysRemainingLabel(row.daysRemaining ?? null)}</p>
        </div>
      ),
    },
    {
      key: 'counts',
      header: 'تراخيص / دفعات',
      cell: (row) => (
        <div className="flex gap-1.5">
          <Badge variant="secondary">{row._count?.licenses ?? 0}</Badge>
          <Badge variant="muted">{row._count?.payments ?? 0}</Badge>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">الاشتراكات</h1>
          <p className="text-sm text-muted-foreground">
            الاشتراكات التجارية المرتبطة بالعملاء والتراخيص
          </p>
        </div>
      </header>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        isLoading={query.isLoading}
        error={query.isError ? (query.error as ApiError)?.friendlyMessage : undefined}
        onRetry={() => query.refetch()}
        page={page}
        totalPages={query.data?.meta.totalPages ?? 1}
        total={query.data?.meta.total ?? 0}
        onPageChange={setPage}
        search={search}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        searchPlaceholder="ابحث باسم العميل…"
        emptyTitle="لا توجد اشتراكات بعد"
        emptyDescription="أنشئ اشتراكًا من صفحة العميل."
        toolbar={
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value || 'all'}
                size="sm"
                variant={status === filter.value ? 'default' : 'outline'}
                onClick={() => { setStatus(filter.value); setPage(1); }}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        }
      />
    </div>
  );
}

export { STATUS_LABELS, PRIORITY_VARIANTS };
