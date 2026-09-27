import { useQuery } from '@tanstack/react-query';
import { Clock, Download, Loader2, Monitor, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { date } from '@/lib/portal-format';
import { portalApi } from '@/lib/portal-api';

/** Formats a byte count for a human reader. */
function fileSize(bytes: number | null): string {
  if (!bytes) return '—';
  const mb = bytes / 1_048_576;
  return mb >= 1 ? `${mb.toFixed(1)} ميجابايت` : `${Math.round(bytes / 1024)} كيلوبايت`;
}

/**
 * The installer, behind the payment gate.
 *
 * The gate is server-side — `canDownload` is a stored flag the owner sets — so
 * this page only reflects the decision. Hiding the button here is a courtesy
 * to the customer, not the control itself.
 */
export function PortalDownloadPage() {
  const overview = useQuery({ queryKey: ['portal', 'overview'], queryFn: portalApi.overview });

  if (overview.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!overview.data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          تعذّر تحميل بيانات التنزيل.
        </CardContent>
      </Card>
    );
  }

  const { canDownload, latestRelease } = overview.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">تنزيل البرنامج</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          أحدث إصدار متاح لنظام Windows.
        </p>
      </div>

      {!canDownload ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning/10">
              <ShieldAlert className="size-6 text-warning" />
            </div>
            <div>
              <p className="font-medium">التنزيل مقفل حالياً</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                يُفتح التنزيل بعد تأكيد الدفع. أرسل صورة الحوالة من صفحة «الاشتراك» وسنصدر
                الكود ونفتح التنزيل معاً.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : latestRelease ? (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Download className="size-5" />
                الإصدار الحالي
              </CardTitle>
              <Badge variant="outline" dir="ltr">
                v{latestRelease.version} · build {latestRelease.buildNumber}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">تاريخ الإصدار</dt>
                  <dd className="font-medium">{date(latestRelease.releasedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">حجم الملف</dt>
                  <dd className="font-medium">{fileSize(latestRelease.fileSize)}</dd>
                </div>
              </dl>

              <Button asChild className="w-full gap-2 sm:w-auto">
                <a href="/api/v1/portal/download">
                  <Download className="size-4" />
                  تحميل الآن
                </a>
              </Button>
            </CardContent>
          </Card>

          {latestRelease.releaseNotes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ما الجديد</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm text-muted-foreground">
                  {latestRelease.releaseNotes}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">لا يوجد إصدار منشور بعد</p>
            <p className="mt-1 text-sm text-muted-foreground">
              الدفع مؤكَّد. سيظهر هنا أول إصدار ننشره.
            </p>
          </CardContent>
        </Card>
      )}

      {/* How to install, only relevant once the download is open */}
      {canDownload && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Monitor className="size-5" />
              خطوات التفعيل
            </CardTitle>
            <CardDescription>ثلاث خطوات فقط.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              {[
                'ثبّت البرنامج على جهازك.',
                'افتح «أكواد التفعيل» وانسخ الكود.',
                'الصق الكود في شاشة التفعيل — يُربط بجهازك تلقائياً.',
              ].map((step, index) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Clock className="mt-0.5 size-3.5 shrink-0" />
              يُربط الكود بعدد الأجهزة المسموح في باقتك. لتغيير الأجهزة راجع الدعم الفني.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
