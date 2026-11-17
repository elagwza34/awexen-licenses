import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {Link,useParams,useSearchParams} from 'react-router-dom';
import { AlertCircle, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { money } from "@/lib/portal-format";
import { portalApi } from "@/lib/portal-api";
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';

/** One plan catalogue; interval and subscription are explicit customer choices. */
export function PortalSubscriptionPage() {
  const {systemKey}=useParams();
  const [parameters]=useSearchParams();
  const client = useQueryClient();
  const customer = useQuery({
    queryKey: ["portal", "me"],
    queryFn: portalApi.me,
  });
  const catalogue = useQuery({
    queryKey: ["portal", "catalogue"],
    queryFn: portalApi.catalogue,
  });
  const subscriptions = useQuery({
    queryKey: ["portal", "billing-subscriptions"],
    queryFn: portalApi.billingSubscriptions,
  });
  const [planId, setPlanId] = useState<number | null>(null);
  const [interval, setInterval] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [subscriptionId, setSubscriptionId] = useState<number | null>(Number(parameters.get('subscriptionId'))||0);
  useEffect(() => {
    if (customer.data?.requestedPlanId && !parameters.get('subscriptionId'))
      setPlanId(customer.data.requestedPlanId);
  }, [customer.data?.requestedPlanId]);
  useEffect(() => {
    const source=subscriptions.data?.subscriptions.find(s=>s.id===Number(parameters.get('subscriptionId'))&&s.plan.system.key===systemKey);
    if(source){setPlanId(source.planId);setInterval(source.billingInterval==='YEARLY'?'YEARLY':'MONTHLY');setSubscriptionId(source.id);}
  }, [subscriptions.data,parameters,systemKey]);
  const plans=catalogue.data?.plans.filter(p=>p.system.key===systemKey)??[];
  const eligibleSubscriptions=subscriptions.data?.subscriptions.filter(s=>s.plan.system.key===systemKey&&['ACTIVE','TRIAL','EXPIRED'].includes(s.status))??[];
  const selected = plans.find((p) => p.id === planId) ?? null;
  const quote = useQuery({
    queryKey: [
      "portal",
      "billing-quote",
      customer.data?.id,
      planId,
      interval,
      subscriptionId,
    ],
    queryFn: () =>
      portalApi.quote({
        planId: planId!,
        billingInterval: interval,
        ...(subscriptionId ? { subscriptionId } : {}),
      }),
    enabled: !!selected && subscriptionId !== null && !!customer.data,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const expired =
    !!quote.data && new Date(quote.data.expiresAt).getTime() <= clock;
  const mutation = useMutation({
    mutationFn: portalApi.requestActivation,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["portal"] });
      setPlanId(null);
    },
  });
  if (customer.isLoading || catalogue.isLoading || subscriptions.isLoading)
    return (
      <p className="p-8" role="status">
        جارٍ تحميل الباقات والاشتراكات…
      </p>
    );
  if (customer.isError || catalogue.isError || subscriptions.isError)
    return (
      <p role="alert" className="p-8">
        تعذر تحميل بيانات الاشتراك. أعد تحميل الصفحة للمحاولة.
      </p>
    );
  return (
    <div className="space-y-6">
      <div>
        <Link to="/portal/subscription" className="mb-4 inline-block text-sm text-primary underline">العودة إلى الأنظمة والاشتراكات</Link>
        <h1 className="text-xl font-bold">{plans[0]?.system.nameAr??'خطط النظام'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          اختر الباقة والمدة. تُفتح المميزات بعد مراجعة الدفع، بنفس البرنامج
          ونفس مفتاح الاشتراك الحالي عند الترقية.
        </p>
      </div>
      {!!subscriptions.data?.unlinkedLicenseCount && (
        <p role="note" className="rounded-md border p-4 text-sm">
          لديك ترخيص قديم يتطلب مراجعة الإدارة قبل الترقية للحفاظ على المفتاح
          والمدة المتبقية. اختر شراء اشتراك جديد فقط إذا كنت تريد اشتراكًا
          مستقلًا.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p id="billing-term-label" className="text-sm font-medium">مدة الاشتراك</p>
          <Tabs dir="rtl" value={interval} onValueChange={value=>setInterval(value as 'MONTHLY'|'YEARLY')}>
            <TabsList aria-labelledby="billing-term-label" className="mt-2 grid h-auto w-full grid-cols-2"><TabsTrigger className="min-h-11" value="MONTHLY">شهري</TabsTrigger><TabsTrigger className="min-h-11" value="YEARLY">سنوي · خصم 15%</TabsTrigger></TabsList>
          </Tabs>
          <p className="mt-2 text-sm text-muted-foreground">السنوي: خصم 15% من قيمة 12 شهرًا. رسوم التأسيس منفصلة وتُدفع مرة واحدة.</p>
        </div>
        <div>
          <Label htmlFor="billing-contract">الاشتراك المطلوب</Label>
          <select
            id="billing-contract"
            value={subscriptionId ?? 0}
            onChange={(e) => setSubscriptionId(Number(e.target.value))}
            className="mt-2 w-full rounded-md border bg-background p-3"
          >
            <option value={0}>شراء اشتراك جديد مستقل</option>
            {eligibleSubscriptions.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.id} — {s.plan.nameAr ?? s.plan.name} —{" "}
                {s.billingInterval === "YEARLY" ? "سنوي" : "شهري"}
              </option>
            ))}
          </select>
        </div>
      </div>
      {mutation.isSuccess && (
        <p role="status" className="rounded-md border p-4">
          تم إرسال طلب الدفع للمراجعة. لم تتغير المميزات بعد؛ راجع صفحة طلباتي
          لمتابعة القبول.
        </p>
      )}
      {!plans.length && (
        <p role="status">لا توجد باقات متاحة للبيع حاليًا.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const option = plan.billingOptions.find(
            (p) => p.billingInterval === interval,
          );
          return (
            <button
              type="button"
              key={plan.id}
              disabled={!option || mutation.isPending}
              aria-pressed={planId === plan.id}
              onClick={() => setPlanId(plan.id)}
              className={`rounded-lg border p-5 text-start ${planId === plan.id ? "border-primary ring-2 ring-primary" : ""} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <h2 className="font-bold">{plan.nameAr ?? plan.name}</h2>
              <p className="my-3 text-2xl font-bold">
                {option
                  ? money(option.price, plan.currency)
                  : "غير متاح لهذه المدة"}
              </p>
              <p className="text-sm text-muted-foreground">
                {interval === "YEARLY" ? "سعر السنة بعد خصم 15%" : "سعر الشهر"}
              </p>
              <p className="mt-3 text-sm">رسوم التأسيس لأول اشتراك: {money(plan.setupFee,plan.currency)} مرة واحدة</p>
              <p className="mt-2 text-sm">
                {plan.maxDevices} جهاز · {plan.maxUsers} مستخدم ·{" "}
                {plan.maxBranches} فرع · {plan.maxWarehouses} مخزن
              </p>
              {plan.description && (
                <p className="mt-3 text-sm">{plan.description}</p>
              )}
            </button>
          );
        })}
      </div>
      {selected && (
        <Card>
          <CardHeader>
            <CardTitle>
              عرض السعر — {selected.nameAr ?? selected.name}
            </CardTitle>
            <CardDescription>
              عرض ثابت لمدة 15 دقيقة. راجع الفترة والمبلغ قبل التحويل. تبدأ
              الخدمة من التاريخ المعروض، وتتاح المميزات بعد قبول الدفع.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {quote.isFetching ? (
              <p role="status">جارٍ حساب المبلغ…</p>
            ) : quote.isError ? (
              <p role="alert">{(quote.error as Error).message}</p>
            ) : (
              quote.data && (
                <>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt>قيمة الخدمة</dt>
                      <dd>
                        {money(quote.data.serviceCharge, quote.data.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt>رصيد المدة غير المستخدمة</dt>
                      <dd>{money(quote.data.credit, quote.data.currency)}</dd>
                    </div>
                    <div>
                      <dt>رسوم التفعيل لأول مرة</dt>
                      <dd>{money(quote.data.setupFee, quote.data.currency)}</dd>
                    </div>
                    <div>
                      <dt>المطلوب دفعه</dt>
                      <dd className="text-xl font-bold">
                        {money(quote.data.amount, quote.data.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt>بداية الفترة</dt>
                      <dd>
                        {new Date(quote.data.periodStart).toLocaleDateString(
                          "ar-EG",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>انتهاء الفترة</dt>
                      <dd>
                        {new Date(quote.data.periodEnd).toLocaleDateString(
                          "ar-EG",
                        )}
                      </dd>
                    </div>
                  </dl>
                  {expired ? (
                    <p role="alert">
                      انتهى عرض السعر. حدّثه وراجع المبلغ قبل إرسال الحوالة.
                    </p>
                  ) : (
                    <RequestForm
                      key={quote.data.id}
                      isPending={mutation.isPending}
                      error={(mutation.error as Error | undefined)?.message}
                      onSubmit={(receipt, notes) => {
                        if (
                          new Date(quote.data!.expiresAt).getTime() <=
                          Date.now()
                        )
                          return;
                        mutation.mutate({
                          planId: selected.id,
                          amount: quote.data!.amount,
                          quoteId: quote.data!.id,
                          receipt,
                          notes,
                        });
                      }}
                    />
                  )}
                </>
              )
            )}
            <Button
              type="button"
              variant="outline"
              disabled={quote.isFetching || mutation.isPending}
              onClick={() => quote.refetch()}
            >
              تحديث عرض السعر
            </Button>
          </CardContent>
        </Card>
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
  const [notes, setNotes] = useState("");

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
        <p className="text-xs text-muted-foreground">
          JPG أو PNG أو WebP — حتى 5 ميجابايت.
        </p>
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
