import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  KeyRound,
  Loader2,
  Monitor,
  ReceiptText,
  ShoppingCart,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { portalApi } from '@/lib/portal-api';
import { date } from '@/lib/portal-format';

/** A single headline number. */
function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: typeof KeyRound;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning'
        : 'bg-primary/10 text-primary';

  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-bold">{value}</p>
          {hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The customer's landing page.
 *
 * A summary only — the key itself lives on its own page behind an explicit
 * reveal, so this screen never holds a usable secret. Everything here is scoped
 * by the token rather than by an id in the URL, so one customer cannot read
 * another's licence by editing a link.
 */
export function PortalOverviewPage() {
  const overview = useQuery({ queryKey: ['portal', 'overview'], queryFn: portalApi.overview });
  const requests = useQuery({ queryKey: ['portal', 'requests'], queryFn: portalApi.requests });

  if (overview.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="font-medium">تعذّر تحميل بياناتك</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {(overview.error as Error | undefined)?.message ?? 'حدث خطأ غير متوقع'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const data = overview.data;
  const licenses = data.licenses;
  const active = licenses.filter((l) => l.status === 'ACTIVE');
  const pending = (requests.data?.data ?? []).filter((r) => r.status === 'PENDING');
  const devicesUsed = licenses.reduce((sum, l) => sum + l.devices.length, 0);
  const devicesTotal = licenses.reduce((sum, l) => sum + l.maxDevices, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">أهلاً، {data.customer.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.customer.company ?? 'حسابك'} · {data.customer.email}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={KeyRound}
          label="أكواد التفعيل"
          value={licenses.length === 0 ? 'لا يوجد' : String(licenses.length)}
          hint={licenses.length === 0 ? 'اختر باقة للبدء' : `${active.length} نشط`}
          tone={licenses.length > 0 ? 'success' : 'default'}
        />
        <StatCard
          icon={Monitor}
          label="الأجهزة المستخدمة"
          value={devicesTotal === 0 ? '—' : `${devicesUsed} / ${devicesTotal}`}
          hint="من إجمالي التراخيص"
        />
        <StatCard
          icon={ReceiptText}
          label="طلبات بانتظار المراجعة"
          value={String(pending.length)}
          hint={pending.length > 0 ? 'نتحقق من الدفع' : 'لا شيء معلّق'}
          tone={pending.length > 0 ? 'warning' : 'default'}
        />
        <StatCard
          icon={Download}
          label="تنزيل البرنامج"
          value={data.canDownload ? 'مفعّل' : 'مقفل'}
          hint={data.canDownload ? 'يمكنك تحميل النسخة' : 'بعد تأكيد الدفع'}
          tone={data.canDownload ? 'success' : 'warning'}
        />
      </div>

      {/* Licences, masked — the real keys live one click away */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-5" />
            تراخيصي
          </CardTitle>
          {licenses.length > 0 && (
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to="/portal/licenses">
                عرض الأكواد
                <ArrowLeft className="size-3.5" />
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {licenses.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-8 text-center">
              <p className="text-sm font-medium">لا توجد تراخيص بعد</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                كود التفعيل يُصدر فور اعتماد الدفع من فريقنا. اختر باقة وأرسل الحوالة لتبدأ.
              </p>
              <Button asChild size="sm" className="gap-1.5">
                <Link to="/portal/subscription">
                  <ShoppingCart className="size-4" />
                  تصفح الباقات
                </Link>
              </Button>
            </div>
          ) : (
            <ul className="space-y-3">
              {licenses.map((license) => {
                const expiringSoon =
                  license.expiresAt !== null &&
                  (new Date(license.expiresAt).getTime() - Date.now()) / 86_400_000 < 30;

                return (
                  <li key={license.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{license.plan.nameAr ?? license.plan.name}</span>
                        <Badge variant={license.status === 'ACTIVE' ? 'success' : 'secondary'}>
                          {license.status === 'ACTIVE' ? 'نشط' : license.status}
                        </Badge>
                        {license.isTrial ? <Badge variant="outline">تجريبي</Badge> : null}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {license.status === 'ACTIVE' ? (
                          <CheckCircle2 className="size-3 text-success" />
                        ) : (
                          <Clock className="size-3" />
                        )}
                        {license.expiresAt ? `ينتهي ${date(license.expiresAt)}` : 'صلاحية مدى الحياة'}
                        {expiringSoon && license.status === 'ACTIVE' && (
                          <span className="font-medium text-warning">· يقارب على الانتهاء</span>
                        )}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="text-xs text-muted-foreground">الأجهزة</p>
                      <p className="font-medium tabular-nums">
                        {license.devices.length} / {license.maxDevices}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Download gate */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="size-5" />
            تنزيل البرنامج
          </CardTitle>
          {data.latestRelease && (
            <Badge variant="outline" dir="ltr">
              v{data.latestRelease.version}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {!data.canDownload ? (
            <div className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm">
              <Clock className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="text-warning">
                التنزيل متاح بعد تأكيد الدفع. أرسل صورة الحوالة وسنرد عليك فور الاعتماد.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-success/10 p-3">
              <p className="text-sm text-success">
                الدفع مؤكَّد — يمكنك تحميل النسخة الآن.
              </p>
              <Button asChild size="sm">
                <a href="/api/v1/portal/download">تحميل</a>
              </Button>
            </div>
          )}

          {data.latestRelease?.releaseNotes && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">ملاحظات الإصدار</summary>
              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                {data.latestRelease.releaseNotes}
              </p>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
