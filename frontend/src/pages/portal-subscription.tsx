import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { money } from '@/lib/portal-format';
import { portalApi } from '@/lib/portal-api';

/** The plan catalogue, with the request form beside it. */
export function PortalSubscriptionPage() {
  const client = useQueryClient();
  const catalogue = useQuery({ queryKey: ['portal', 'catalogue'], queryFn: portalApi.catalogue });
  const customer = useQuery({ queryKey: ['portal', 'me'], queryFn: portalApi.me });
  const [planId, setPlanId] = useState<number | null>(null);

  useEffect(() => {
    if (customer.data?.requestedPlanId) setPlanId(customer.data.requestedPlanId);
  }, [customer.data?.requestedPlanId]);
  const mutation = useMutation({
    mutationFn: portalApi.requestActivation,
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ['portal'] });
      // The plan picker is reset so the next purchase is a deliberate act
      // rather than a resubmission of the one that just succeeded.
      setPlanId(null);
      alert(result.message);
    },
  });

  const plans = catalogue.data?.plans ?? [];
  const selected = plans.find((item) => item.id === planId) ?? null;
  const setupFee = customer.data?.downloadEnabled ? 0 : (selected?.setupFee ?? 0);
  const total = (selected?.price ?? 0) + setupFee;

  if (catalogue.isLoading || customer.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (catalogue.isError || customer.isError) return <p role="alert" className="p-8 text-center">تعذّر تحميل بيانات الاشتراك. أعد تحميل الصفحة للمحاولة.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">الاشتراك</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          اختر باقة، حوّل المبلغ، وارفع صورة الحوالة — ثم يصدر كود التفعيل فور المراجعة.
        </p>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">لا توجد باقات متاحة حالياً</p>
            <p className="mt-1 text-sm text-muted-foreground">
              تواصل معنا لمعرفة العروض المتاحة.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const isSelected = plan.id === planId;
              // A zero price means the owner has not published it yet; showing
              // it as a purchasable plan would be a trap.
              const purchasable = plan.price > 0;

              return (
                <button
                  key={plan.id}
                  type="button"
                  disabled={!purchasable}
                  onClick={() => setPlanId(isSelected ? null : plan.id)}
                  className={`flex flex-col rounded-lg border p-4 text-start transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:border-primary/40 hover:bg-accent/40'
                  } ${purchasable ? '' : 'cursor-not-allowed opacity-60'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-bold">{plan.nameAr ?? plan.name}</h2>
                    {isSelected && <Check className="size-5 shrink-0 text-primary" />}
                  </div>

                  <p className="mt-2 text-2xl font-bold tabular-nums">
                    {purchasable ? money(plan.price, plan.currency) : 'غير متاح'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {purchasable
                      ? plan.billingInterval === 'MONTHLY'
                        ? 'شهرياً'
                        : plan.billingInterval === 'YEARLY'
                          ? 'سنوياً'
                          : 'دفعة واحدة'
                      : 'لم يُحدَّد السعر بعد'}
                  </p>

                  {plan.setupFee > 0 && <p className="mt-2 text-xs text-muted-foreground">رسوم التفعيل لأول مرة: {money(plan.setupFee, plan.currency)}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">{plan.maxUsers} مستخدم · {plan.maxBranches} فرع · {plan.maxWarehouses} مخزن</p>
                  {plan.description && (
                    <p className="mt-3 text-sm text-muted-foreground">{plan.description}</p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {plan.maxDevices > 0 && (
                      <Badge variant="outline">{plan.maxDevices} جهاز</Badge>
                    )}
                    {plan.trialDays > 0 && (
                      <Badge variant="outline">{plan.trialDays} يوم تجريبي</Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* The receipt form only appears once a plan is chosen, so the page
              never shows a form that cannot be submitted. */}
          {selected ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Upload className="size-5" />
                  تأكيد الدفع — {selected.nameAr ?? selected.name}
                </CardTitle>
                <CardDescription>
                  حوّل {money(total, selected.currency)} ثم ارفع صورة القسيمة. سيراجعها
                  المالك ويصدر كود التفعيل فور التأكد.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RequestForm
                  isPending={mutation.isPending}
                  error={(mutation.error as Error | undefined)?.message}
                  onSubmit={(receipt, notes) =>
                    mutation.mutate({ planId: selected.id, amount: total, receipt, notes })
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              اختر باقة من الأعلى لعرض نموذج رفع الحوالة.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Receipt capture.
 *
 * Kept as its own component because the file and the reference must reset
 * together: a stale file left in the input is the classic way to resubmit
 * yesterday's receipt by accident.
 */
function RequestForm({
  isPending,
  error,
  onSubmit,
}: {
  isPending: boolean;
  error?: string;
  onSubmit: (receipt: File, notes?: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (file) onSubmit(file, notes.trim() || undefined);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="receipt">صورة قسيمة التحويل</Label>
        <Input
          id="receipt"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="ltr"
        />
        <p className="text-xs text-muted-foreground">JPG أو PNG أو WebP — حتى 5 ميجابايت.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">رقم الحوالة (اختياري)</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="رقم العملية من البنك ليساعدنا على المطابقة بسرعة"
          className="min-h-[60px]"
        />
      </div>

      {error && (
        <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <Button type="submit" disabled={isPending || !file} className="gap-2">
        {isPending ? <Loader2 className="animate-spin" /> : <Upload />}
        إرسال الطلب
      </Button>
    </form>
  );
}
