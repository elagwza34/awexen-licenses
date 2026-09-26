import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { PaymentStatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils';
import type { Paginated, Payment, PaymentStatus } from '@/types';

const PAGE_SIZE = 20;

const STATUS_FILTERS: Array<{ value: PaymentStatus | ''; label: string }> = [
  { value: '', label: 'الكل' },
  { value: 'PENDING', label: 'معلق' },
  { value: 'PAID', label: 'مدفوع' },
  { value: 'FAILED', label: 'فشل' },
  { value: 'REFUNDED', label: 'مسترد' },
  { value: 'CANCELLED', label: 'ملغى' },
];

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'تحويل بنكي', CASH: 'نقدي', CARD: 'بطاقة', ONLINE: 'أونلاين', OTHER: 'أخرى',
};

export function PaymentsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PaymentStatus | ''>('');

  const query = useQuery({
    queryKey: ['payments', { page, search, status }],
    queryFn: () =>
      api.get<Paginated<Payment> & { totals?: { totalAmount: number; refundedAmount: number; count: number } }>(
        '/payments',
        { page, limit: PAGE_SIZE, search: search || undefined, status: status || undefined },
      ),
  });

  const columns: Column<Payment>[] = [
    {
      key: 'customer',
      header: 'العميل',
      cell: (row) => (
        <p className="truncate font-medium">
          {row.customer?.company || row.customer?.name || '—'}
        </p>
      ),
    },
    {
      key: 'amount',
      header: 'المبلغ',
      cell: (row) => (
        <div>
          <p className="text-sm font-medium">{formatMoney(row.amount, row.currency)}</p>
          {/* A partial refund is recorded alongside, never instead of, the amount. */}
          {row.refundedAmount > 0 && (
            <p className="text-xs text-destructive">
              مسترد: {formatMoney(row.refundedAmount, row.currency)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'method',
      header: 'الطريقة',
      cell: (row) => <span className="text-sm">{METHOD_LABELS[row.method] ?? row.method}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (row) => <PaymentStatusBadge value={row.status} showCode />,
    },
    {
      key: 'reference',
      header: 'المرجع',
      cell: (row) => (
        <span className="ltr text-xs text-muted-foreground">
          {row.transactionReference ?? '—'}
        </span>
      ),
    },
    {
      key: 'paidAt',
      header: 'تاريخ الدفع',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.paidAt)}</span>
      ),
    },
  ];

  const totals = query.data?.totals;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">المدفوعات</h1>
        <p className="text-sm text-muted-foreground">
          سجل مالي دائم — لا يُعدَّل بعد التحقق، بل يُسترد
        </p>
      </header>

      {totals && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">العدد: {totals.count}</Badge>
          <Badge variant="success">الإجمالي: {formatMoney(totals.totalAmount)}</Badge>
          {totals.refundedAmount > 0 && (
            <Badge variant="destructive">المسترد: {formatMoney(totals.refundedAmount)}</Badge>
          )}
        </div>
      )}

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
        searchPlaceholder="ابحث بالعميل أو رقم المرجع…"
        emptyTitle="لا توجد مدفوعات بعد"
        emptyDescription="سجّل أول دفعة من صفحة العميل."
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
