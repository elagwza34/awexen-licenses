import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CheckCircle2, KeyRound, RefreshCw, Undo2 } from 'lucide-react';
import { ReceiptLink } from '@/components/receipt-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { PaymentStatusBadge } from '@/components/status-badge';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import type { Paginated, Payment, PaymentStatus, Plan } from '@/types';

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
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { confirm, confirmDialog } = useConfirm();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [acting, setActing] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const [approving, setApproving] = useState<Payment | null>(null);
  const [approvePlanId, setApprovePlanId] = useState<string>('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['payments'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
  };

  const verify = useMutation({
    mutationFn: ({ id, renew }: { id: number; renew: boolean }) =>
      api.post(`/payments/${id}/verify`, { renewSubscription: renew }),
    onMutate: ({ id, renew }) => setActing(`${renew ? 'verify-renew' : 'verify'}-${id}`),
    onSettled: () => setActing(null),
    onSuccess: (_data, variables) => {
      invalidate();
      toast.success(
        'تم تأكيد الدفعة',
        variables.renew ? 'وجُدّد الاشتراك المرتبط' : undefined,
      );
    },
    onError: (error) => toast.error('تعذّر التأكيد', (error as ApiError).friendlyMessage),
  });

  const refund = useMutation({
    mutationFn: ({ id, amount, reason }: { id: number; amount: number; reason: string }) =>
      api.post(`/payments/${id}/refund`, { amount, reason }),
    onSuccess: () => {
      invalidate();
      toast.success('تم تسجيل الاسترداد', 'السجل الأصلي لم يُعدَّل');
      setRefunding(null);
      setRefundAmount('');
      setRefundReason('');
    },
    onError: (error) => toast.error('تعذّر الاسترداد', (error as ApiError).friendlyMessage),
  });

  /**
   * Approving an activation confirms the money and issues the licence in one
   * step, so the reviewer does not have to open the customer, pick a plan and
   * come back. The issued key is shown in a toast because it is the only moment
   * the owner sees it in full here.
   */
  const approveActivation = useMutation({
    mutationFn: ({ id, planId }: { id: number; planId?: number }) =>
      api.post<{ message: string; license?: { licenseKey: string } | null }>(
        `/payments/${id}/approve-activation`,
        { planId },
      ),
    onMutate: ({ id }) => setActing(`approve-${id}`),
    onSettled: () => setActing(null),
    onSuccess: (result) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['licenses'] });
      toast.success('تم اعتماد الطلب', result.message);
      if (result.license) {
        // The key is shown once, here, so the owner can hand it over without
        // opening the licences screen.
        window.prompt('كود التفعيل — انسخه للعميل:', result.license.licenseKey);
      }
      setApproving(null);
    },
    onError: (error) => {
      const apiError = error as ApiError;
      toast.error('تعذّر اعتماد الطلب', apiError.friendlyMessage);
      setApproving(null);
    },
  });

  const canVerify = can('payments.verify');
  const canRefund = can('payments.refund');

  // The plans are needed for the approval dialog: a portal request carries only
  // an amount, so the owner has to say which tier was actually bought whenever
  // the amount alone is ambiguous.
  const plansQuery = useQuery({
    queryKey: ['plans', 'picker'],
    queryFn: () => api.get<{ data: Plan[] }>('/plans', { limit: 100 }),
    enabled: canVerify,
  });

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
        <div>
          <span className="ltr text-xs text-muted-foreground">
            {row.transactionReference ?? '—'}
          </span>
          {/* The receipt is the evidence. Showing it inline saves the reviewer a
              download-and-open round trip before every decision. */}
          {row.receiptUrl && (
            <ReceiptLink
              url={row.receiptUrl}
              label="عرض الحوالة"
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            />
          )}
        </div>
      ),
    },
    {
      key: 'paidAt',
      header: 'تاريخ الدفع',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.paidAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (row) => (
        <div className="flex gap-1.5">
          {/* A request that carries a receipt came from the customer portal, so
              one button confirms the money and issues the key in a single step. */}
          {row.status === 'PENDING' && row.receiptUrl && canVerify && (
            <Button
              size="sm"
              isLoading={acting === `approve-${row.id}`}
              onClick={() => {
                setApproving(row);
                setApprovePlanId('');
              }}
            >
              <KeyRound />
              إصدار كود
            </Button>
          )}
          {row.status === 'PENDING' && canVerify && (
            <>
              <Button
                size="sm"
                variant="outline"
                isLoading={acting === `verify-${row.id}`}
                onClick={() =>
                  confirm(
                    {
                      title: 'تأكيد الدفعة',
                      description: 'سيتحوّل السجل إلى "مدفوع" ولن يكون قابلًا للتعديل بعدها.',
                      confirmLabel: 'تأكيد',
                    },
                    () => verify.mutate({ id: row.id, renew: false }),
                  )
                }
              >
                <CheckCircle2 />
                تأكيد
              </Button>
              {row.subscriptionId && (
                <Button
                  size="sm"
                  variant="outline"
                  isLoading={acting === `verify-renew-${row.id}`}
                  onClick={() =>
                    confirm(
                      {
                        title: 'تأكيد الدفعة وتجديد الاشتراك',
                        description: 'سيتجدد الاشتراك المرتبط فترة واحدة عند التأكيد.',
                        confirmLabel: 'تأكيد وتجديد',
                      },
                      () => verify.mutate({ id: row.id, renew: true }),
                    )
                  }
                >
                  <RefreshCw />
                  وتجديد
                </Button>
              )}
            </>
          )}
          {row.status === 'PAID' && row.refundedAmount < row.amount && canRefund && (
            <Button size="sm" variant="ghost" onClick={() => setRefunding(row)}>
              <Undo2 />
              استرداد
            </Button>
          )}
        </div>
      ),
    },
  ];

  const totals = query.data?.totals;

  return (
    <div className="space-y-4">
      {confirmDialog}

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

      <Dialog open={refunding !== null} onOpenChange={(open) => !open && setRefunding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>استرداد دفعة</DialogTitle>
            <DialogDescription>
              المبلغ الأصلي يبقى كما هو، ويُسجَّل المبلغ المسترد بجانبه.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (refunding) {
                refund.mutate({
                  id: refunding.id,
                  amount: Math.round(Number(refundAmount) * 100),
                  reason: refundReason,
                });
              }
            }}
          >
            {approving && (
              <>
                <p className="rounded-md bg-muted p-3 text-sm">
                  المبلغ: <span className="font-semibold">{formatMoney(approving.amount, approving.currency)}</span>
                  {approving.customer?.company || approving.customer?.name ? (
                    <span className="ms-2 text-muted-foreground">
                      — {approving.customer.company || approving.customer.name}
                    </span>
                  ) : null}
                </p>

                {approving.receiptUrl && (
                  <ReceiptLink
                    url={approving.receiptUrl}
                    label="اعرض صورة الحوالة قبل الاعتماد"
                    iconSize="size-4"
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                  />
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="approve-plan">الباقة</Label>
                  <select
                    id="approve-plan"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={approvePlanId}
                    onChange={(event) => setApprovePlanId(event.target.value)}
                  >
                    <option value="">تلقائي (مطابق للمبلغ)</option>
                    {(plansQuery.data?.data ?? []).map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.nameAr ?? plan.name} — {formatMoney(plan.price, plan.currency)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    يُختار تلقائياً عند مطابقة المبلغ لباقة واحدة. حدّده يدوياً إذا تطابقت أكثر من باقة.
                  </p>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setApproving(null)}>
                    إلغاء
                  </Button>
                  <Button
                    type="button"
                    isLoading={approveActivation.isPending}
                    onClick={() =>
                      approveActivation.mutate({
                        id: approving.id,
                        planId: approvePlanId ? Number(approvePlanId) : undefined,
                      })
                    }
                  >
                    <KeyRound />
                    تأكيد وإصدار الكود
                  </Button>
                </DialogFooter>
              </>
            )}

            {refunding && (
              <p className="rounded-md bg-muted p-3 text-sm">
                المتاح للاسترداد:{' '}
                <span className="font-medium">
                  {formatMoney(refunding.amount - refunding.refundedAmount, refunding.currency)}
                </span>
              </p>
            )}
            <div className="space-y-2">
              <Label>المبلغ</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
                dir="ltr"
                className="text-start"
              />
            </div>
            <div className="space-y-2">
              <Label>السبب *</Label>
              <Textarea
                rows={2}
                value={refundReason}
                onChange={(event) => setRefundReason(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                variant="destructive"
                isLoading={refund.isPending}
                disabled={!refundAmount || !refundReason}
              >
                تأكيد الاسترداد
              </Button>
              <Button type="button" variant="outline" onClick={() => setRefunding(null)}>
                إلغاء
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
