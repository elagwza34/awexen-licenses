import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils";
import type { Plan, Subscription } from "@/types";
import type { BillingQuote } from "@/lib/portal-api";

export function SubscriptionUpgradeDialog({
  subscription,
  onClose,
}: {
  subscription: Subscription;
  onClose: () => void;
}) {
  const [planId, setPlanId] = useState(subscription.planId);
  const [interval, setInterval] = useState(
    subscription.billingInterval === "YEARLY" ? "YEARLY" : "MONTHLY",
  );
  const [quote, setQuote] = useState<BillingQuote | null>(null);
  const plans = useQuery({
    queryKey: ["plans", "billing-active"],
    queryFn: () => api.get<{ data: Plan[] }>("/plans", { status: "ACTIVE" }),
  });
  const preview = useMutation({
    mutationFn: () =>
      api.post<BillingQuote>(
        `/subscriptions/${subscription.id}/change-plan/quote`,
        { planId, billingInterval: interval },
      ),
    onSuccess: setQuote,
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<{ payment: { id: number } }>(
        `/subscriptions/${subscription.id}/change-plan`,
        { planId, billingInterval: interval, quoteId: quote!.id },
      ),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ترقية أو تجديد الاشتراك #{subscription.id}</DialogTitle>
          <DialogDescription>
            معاينة المبلغ لا تغير الترخيص. التفعيل يتم من شاشة الدفعات بعد
            مراجعة التحصيل.
          </DialogDescription>
        </DialogHeader>
        {plans.isError ? (
          <p role="alert">تعذر تحميل الباقات. أعد المحاولة.</p>
        ) : (
          <>
            <Label htmlFor="upgrade-plan">الباقة المطلوبة</Label>
            <select
              id="upgrade-plan"
              value={planId}
              disabled={
                preview.isPending || create.isPending || create.isSuccess
              }
              onChange={(e) => {
                setPlanId(Number(e.target.value));
                setQuote(null);
              }}
              className="rounded-md border bg-background p-3"
            >
              {plans.data?.data
                .filter((p) => p.enforceEntitlements)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameAr ?? p.name}
                  </option>
                ))}
            </select>
            <Label htmlFor="upgrade-interval">مدة الاشتراك</Label>
            <select
              id="upgrade-interval"
              value={interval}
              disabled={
                preview.isPending || create.isPending || create.isSuccess
              }
              onChange={(e) => {
                setInterval(e.target.value);
                setQuote(null);
              }}
              className="rounded-md border bg-background p-3"
            >
              <option value="MONTHLY">شهري</option>
              <option value="YEARLY">سنوي</option>
            </select>
            <Button
              variant="outline"
              disabled={
                preview.isPending ||
                create.isPending ||
                create.isSuccess ||
                plans.isLoading
              }
              onClick={() => preview.mutate()}
            >
              حساب عرض السعر
            </Button>
            {preview.isError && (
              <p role="alert">{(preview.error as Error).message}</p>
            )}
            {quote && (
              <div className="rounded-md border p-4 text-sm">
                <p>
                  قيمة الخدمة:{" "}
                  {formatMoney(quote.serviceCharge, quote.currency)}
                </p>
                <p>
                  رصيد المدة غير المستخدمة:{" "}
                  {formatMoney(quote.credit, quote.currency)}
                </p>
                <p className="font-bold">
                  فرق الدفع: {formatMoney(quote.amount, quote.currency)}
                </p>
                <p>
                  الفترة: {formatDate(quote.periodStart)} —{" "}
                  {formatDate(quote.periodEnd)}
                </p>
                <p>
                  عرض السعر صالح حتى{" "}
                  {new Date(quote.expiresAt).toLocaleTimeString("ar-EG")}.
                </p>
              </div>
            )}
            {create.isError && (
              <p role="alert">{(create.error as Error).message}</p>
            )}
            {create.isSuccess && (
              <p role="status">
                تم إنشاء طلب الدفع #{create.data.payment.id}. راجعه من شاشة
                الدفعات بعد التحصيل؛ الترخيص لم يتغير بعد.
              </p>
            )}
          </>
        )}
        <DialogFooter>
          <Button
            type="button"
            disabled={
              !quote ||
              create.isPending ||
              create.isSuccess ||
              new Date(quote?.expiresAt ?? 0).getTime() <= Date.now()
            }
            onClick={() => create.mutate()}
          >
            إنشاء طلب الدفع
          </Button>
          <Button
            variant="outline"
            disabled={create.isPending}
            onClick={onClose}
          >
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
