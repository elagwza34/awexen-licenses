import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { portalApi } from '@/lib/portal-api';
import type { PortalLicense } from '@/lib/portal-api';
const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'نشط', className: 'bg-success/15 text-success border-success/30' },
  EXPIRED: { label: 'منتهي', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  SUSPENDED: { label: 'موقوف', className: 'bg-warning/15 text-warning border-warning/30' },
  REVOKED: { label: 'ملغى', className: 'bg-muted text-muted-foreground border-border' },
};

/** Remaining days, or null for a perpetual licence. */
function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * One key, with the reveal held deliberately.
 *
 * The key is masked by default and only written to the clipboard on an
 * explicit click. There is no hover-to-reveal, because a key that appears on
 * mouse movement is a key that ends up in a screenshot of a support call.
 */
function LicenseCard({ license, fullKey }: { license: PortalLicense; fullKey?: string }) {
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);

  const status = STATUS_STYLE[license.status] ?? STATUS_STYLE.REVOKED;
  const remaining = daysLeft(license.expiresAt);
  const key = revealed && fullKey ? fullKey : license.licenseKey;

  const copy = async () => {
    if (!fullKey) {
      toast.show('الكود الكامل غير متاح، حدّث الصفحة وحاول مرة أخرى');
      return;
    }
    try {
      await navigator.clipboard.writeText(fullKey);
      toast.show('تم نسخ كود التفعيل');
    } catch {
      toast.show('تعذّر النسخ — حدّد الكود وانسخه يدوياً');
    }
  };

  const used = license.devices.length;
  const free = Math.max(0, license.maxDevices - used);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 border-b bg-muted/40">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" />
            {license.plan.nameAr ?? license.plan.name}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {license.isTrial ? 'نسخة تجريبية' : 'ترخيص مدفوع'} · يبدأ {formatDate(license.startsAt)}
          </p>
        </div>
        <Badge variant="outline" className={status.className}>
          {status.label}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">كود التفعيل</p>
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="flex-1 select-all break-all font-mono text-sm tracking-wider">
              {key}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? 'إخفاء الكود' : 'إظهار الكود'}
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              نسخ
            </Button>
          </div>
          {!revealed && fullKey && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              اضغط «إظهار» لرؤية الكود كاملاً قبل نسخه.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            {remaining !== null && remaining > 0 ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <Clock className="h-4 w-4 text-muted-foreground" />
            )}
            {remaining === null ? 'صلاحية الكود' : 'ينتهي في'}
          </span>
          <span className="font-medium">
            {remaining === null ? 'مدى الحياة' : formatDate(license.expiresAt)}
            {remaining !== null && remaining > 0 && (
              <span className="ms-2 text-xs text-muted-foreground">({remaining} يوم)</span>
            )}
          </span>
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Monitor className="h-4 w-4" />
              الأجهزة المرتبطة
            </span>
            <span className="font-medium">
              {used} / {license.maxDevices}
              {free > 0 && <span className="ms-2 text-xs text-success">متاح {free}</span>}
            </span>
          </div>

          {used === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
              لم يتم تفعيل أي جهاز بعد. أدخل الكود في البرنامج على جهازك ليُسجَّل هنا.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {license.devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ShieldCheck
                      className={
                        device.status === 'ACTIVE'
                          ? 'h-3.5 w-3.5 text-success'
                          : 'h-3.5 w-3.5 text-muted-foreground'
                      }
                    />
                    <span className="truncate">{device.deviceName ?? 'جهاز غير معروف'}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {device.lastSeenAt
                      ? new Date(device.lastSeenAt).toLocaleDateString('ar-EG')
                      : 'لم يتصل بعد'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PortalLicensesPage() {
  // The overview carries status, devices and masked keys; the keys endpoint
  // carries the secret. Fetching both lets the page reveal a key the customer
  // already owns without a second click through the UI.
  const overview = useQuery({ queryKey: ['portal', 'overview'], queryFn: portalApi.overview });
  const keys = useQuery({ queryKey: ['portal', 'licenses'], queryFn: portalApi.licenseKeys });

  if (overview.isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">جارِ التحميل…</p>;
  }

  if (overview.isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="font-medium">تعذّر تحميل تراخيصك</p>
          <p className="mt-1 text-sm text-muted-foreground">{overview.error.message}</p>
        </CardContent>
      </Card>
    );
  }

  const licenses = overview.data?.licenses ?? [];

  if (licenses.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <KeyRound className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">لا توجد أكواد تفعيل بعد</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              أكوادك تظهر هنا فور اعتماد الدفع من فريقنا. ابدأ من صفحة «الاشتراك».
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const fullKeys = new Map(keys.data?.data.map((k) => [k.id, k.licenseKey]) ?? []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">أكواد التفعيل</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {licenses.length === 1 ? 'لديك ترخيص واحد' : `لديك ${licenses.length} تراخيص`} — الكود يُفعَّل
          على جهاز واحد في كل مرة.
        </p>
      </div>

      {licenses.map((license) => (
        <LicenseCard key={license.id} license={license} fullKey={fullKeys.get(license.id)} />
      ))}
    </div>
  );
}
