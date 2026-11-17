import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Copy, Eye, EyeOff } from "lucide-react";
import { portalApi } from "@/lib/portal-api";
import { money } from "@/lib/portal-format";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
const states: Record<string, string> = {
  ACTIVE: "نشط",
  TRIAL: "تجريبي",
  EXPIRED: "منتهي",
  CANCELLED: "ملغى",
  SUSPENDED: "موقوف",
  PAST_DUE: "مستحق الدفع",
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("ar-EG") : "غير محدد";
function SubscriptionKey({
  license,
}: {
  license: { id: number; licenseKey: string; status: string };
}) {
  const [revealed, setRevealed] = useState(false),
    toast = useToast();
  const keys = useQuery({
    queryKey: ["portal", "license-keys"],
    queryFn: portalApi.licenseKeys,
    enabled: revealed,
  });
  const key = keys.data?.data.find((x) => x.id === license.id)?.licenseKey;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm">
        كود التفعيل · {states[license.status] ?? license.status}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 break-all">
          {revealed && key ? key : license.licenseKey}
        </code>
        <Button
          className="min-h-11 min-w-11"
          variant="outline"
          size="icon"
          aria-label={revealed ? "إخفاء كود التفعيل" : "إظهار كود التفعيل"}
          onClick={() => setRevealed(!revealed)}
        >
          {revealed ? (
            <EyeOff className="size-4" />
          ) : (
            <Eye className="size-4" />
          )}
        </Button>
        {revealed && key && (
          <Button
            className="min-h-11 min-w-11"
            variant="outline"
            aria-label="نسخ كود التفعيل"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(key);
                toast.show("تم نسخ الكود");
              } catch {
                toast.show("تعذر النسخ. حدد الكود وانسخه يدويًا.");
              }
            }}
          >
            <Copy className="size-4" />
            نسخ
          </Button>
        )}
      </div>
      {revealed && keys.isLoading && <p role="status">جارٍ تحميل الكود…</p>}
      {revealed && keys.isError && (
        <p role="alert">تعذر تحميل الكود. أخفه وأعد المحاولة.</p>
      )}
    </div>
  );
}
export function PortalMySubscriptionsPage() {
  const subscriptions = useQuery({
    queryKey: ["portal", "billing-subscriptions"],
    queryFn: portalApi.billingSubscriptions,
  });
  const overview = useQuery({
    queryKey: ["portal", "overview"],
    queryFn: portalApi.overview,
  });
  const linkedLicenseIds = new Set(
    subscriptions.data?.subscriptions.flatMap((s) => s.licenses.map((l) => l.id)),
  );
  const legacyLicenses = subscriptions.data && overview.data
    ? overview.data.licenses.filter((l) => !linkedLicenseIds.has(l.id))
    : [];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">اشتراكاتي</h1>
        <p className="mt-2 text-muted-foreground">
          تفاصيل اشتراكاتك، وأكواد التفعيل، وتنزيل نسخة كل نظام.
        </p>
      </header>
      {subscriptions.isLoading && <p role="status">جارٍ تحميل اشتراكاتك…</p>}
      {subscriptions.isError && (
        <div role="alert">
          <p>تعذر تحميل الاشتراكات.</p>
          <Button
            className="min-h-11 min-w-11"
            onClick={() => subscriptions.refetch()}
          >
            إعادة المحاولة
          </Button>
        </div>
      )}
      {overview.isLoading && <p role="status">جارٍ تحميل التراخيص…</p>}
      {overview.isError && (
        <div role="alert" className="space-y-3">
          <p>تعذر تحميل التراخيص القديمة. لم تتغير بيانات حسابك.</p>
          <Button className="min-h-11 min-w-11" onClick={() => overview.refetch()}>
            إعادة تحميل التراخيص
          </Button>
          <Link className="block underline" to="/portal/licenses">عرض أكواد التفعيل</Link>
        </div>
      )}
      {subscriptions.data && overview.data && !overview.isError && !subscriptions.data.subscriptions.length && !legacyLicenses.length && (
        <Card>
          <CardContent className="space-y-4 py-8">
            <p>
              ليس لديك اشتراكات بعد. الطلبات قيد المراجعة تظهر في «طلبات
              التفعيل».
            </p>
            <Button className="min-h-11 min-w-11" asChild>
              <Link to="/portal/subscription">تصفح الأنظمة والاشتراكات</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {legacyLicenses.map((license) => (
          <Card key={`legacy-${license.id}`} role="article" aria-label={`ترخيص قديم #${license.id}`}>
            <CardHeader>
              <CardTitle>ترخيص قديم — {license.plan.nameAr ?? license.plan.name}</CardTitle>
              <p>{states[license.status] ?? license.status} · {license.isTrial ? "ترخيص تجريبي" : "ترخيص عادي"}</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm text-muted-foreground">صدر هذا الترخيص قبل ربط التراخيص بسجلات الاشتراكات. كود التفعيل ومدته محفوظان.</p>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-muted-foreground">تاريخ البداية</dt><dd>{date(license.startsAt)}</dd></div>
                <div><dt className="text-muted-foreground">تاريخ الانتهاء</dt><dd>{date(license.expiresAt)}</dd></div>
              </dl>
              <SubscriptionKey license={license} />
              {overview.data?.canDownload && ["ACTIVE", "TRIAL"].includes(license.status) && (
                <Button className="min-h-11 min-w-11" asChild>
                  <Link to={"/portal/download?planKey=" + encodeURIComponent(license.plan.key)}>تنزيل نسخة النظام</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
        {subscriptions.data?.subscriptions.map((s) => (
          <Card key={s.id}>
            <CardHeader>
              <p className="text-sm text-muted-foreground">
                {s.plan.system.nameAr}
              </p>
              <CardTitle>{s.plan.nameAr ?? s.plan.name}</CardTitle>
              <p>
                {states[s.status] ?? s.status} · اشتراك #{s.id}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">المدة</dt>
                  <dd>
                    {s.billingInterval === "YEARLY"
                      ? "سنوي"
                      : s.billingInterval === "MONTHLY"
                        ? "شهري"
                        : s.billingInterval}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    قيمة المدة المتعاقد عليها
                  </dt>
                  <dd>{money(s.price, s.currency)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">تاريخ البداية</dt>
                  <dd>{date(s.startsAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">تاريخ الانتهاء</dt>
                  <dd>{date(s.expiresAt)}</dd>
                </div>
              </dl>
              {s.licenses.length ? (
                s.licenses.map((l) => (
                  <SubscriptionKey key={l.id} license={l} />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  لا يوجد كود تفعيل مرتبط بهذا الاشتراك حتى الآن.
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                {s.licenses.some((l) =>
                  ["ACTIVE", "TRIAL"].includes(l.status),
                ) && (
                  <Button className="min-h-11 min-w-11" asChild>
                    <Link
                      to={
                        "/portal/download?planKey=" +
                        encodeURIComponent(s.plan.key)
                      }
                    >
                      تنزيل نسخة النظام
                    </Link>
                  </Button>
                )}
                {["ACTIVE", "TRIAL", "EXPIRED"].includes(s.status) && (
                  <Button
                    className="min-h-11 min-w-11"
                    variant="outline"
                    asChild
                  >
                    <Link
                      to={
                        "/portal/subscription/" +
                        encodeURIComponent(s.plan.system.key) +
                        "?subscriptionId=" +
                        s.id
                      }
                    >
                      تجديد أو ترقية
                    </Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
