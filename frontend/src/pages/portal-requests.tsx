import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, ReceiptText, ShoppingCart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ReceiptLink } from '@/components/receipt-link';
import { money, dateTime, REQUEST_STATUS } from '@/lib/portal-format';
import { portalApi } from '@/lib/portal-api';

/**
 * The customer's own submission history.
 *
 * This is the screen a customer checks after paying, so it leads with what
 * state the request is in and what happens next, rather than making them read
 * a list to find their latest one.
 */
export function PortalRequestsPage() {
  const requests = useQuery({ queryKey: ['portal', 'requests'], queryFn: portalApi.requests });

  if (requests.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const items = requests.data?.data ?? [];
  const pending = items.filter((item) => item.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">طلبات التفعيل</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pending > 0
            ? `${pending} طلب بانتظار المراجعة.`
            : 'كل طلباتك تمت مراجعتها.'}
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <ReceiptText className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">لم ترسل أي طلب بعد</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                اختر باقة وارفع صورة الحوالة، وسيظهر الطلب هنا مع حالته.
              </p>
            </div>
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/portal/subscription">
                <ShoppingCart className="size-4" />
                تصفح الباقات
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">كل الطلبات</CardTitle>
            <CardDescription>من الأحدث إلى الأقدم.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {items.map((item) => {
                const badge = REQUEST_STATUS[item.status] ?? {
                  label: item.status,
                  variant: 'secondary' as const,
                };

                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      {item.plan && <p className="mb-1 text-sm font-medium">{item.plan.nameAr ?? item.plan.name} · {item.plan.billingInterval === 'YEARLY' ? 'سنوي' : 'شهري'}</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium tabular-nums">
                          {money(item.amount, item.currency)}
                        </span>
                        <Badge variant={badge.variant}>
                          {item.status === 'VERIFIED' ? (
                            <CheckCircle2 className="size-3" />
                          ) : item.status === 'PENDING' ? (
                            <Clock className="size-3" />
                          ) : null}
                          {badge.label}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {dateTime(item.createdAt)}
                        {item.transactionReference && (
                          <>
                            {' · '}
                            <span dir="ltr">رقم الحوالة: {item.transactionReference}</span>
                          </>
                        )}
                      </p>
                      {item.status === 'PENDING' && (
                        <p className="mt-1 text-xs text-warning">
                          بانتظار مراجعة فريقنا — عادةً خلال ساعات العمل.
                        </p>
                      )}
                      {item.status === 'REJECTED' && (
                        <p className="mt-1 text-xs text-destructive">
                          لم نتمكن من تأكيد هذه الدفعة. تواصل معنا لطلب الحوالات.
                        </p>
                      )}
                    </div>

                    {item.receiptUrl && (
                      <ReceiptLink
                        url={`/portal/requests/${item.id}/receipt`}
                        label="عرض الحوالة"
                        fetcher={() => portalApi.receiptBlob(item.id)}
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
