import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CountCard, StatCard } from '@/components/stat-card';
import { ErrorState, LoadingState, Skeleton } from '@/components/state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input, Label } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Copy, Monitor, Play, RefreshCw, ShieldCheck, ShieldOff, Square, Tag } from 'lucide-react';
import { DeviceStatusBadge, LicenseStatusBadge, ValidationStatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { useAuth } from '@/hooks/use-auth';
import { daysRemainingLabel, formatDate, formatDateTime, relativeTime } from '@/lib/utils';
import type { BillingInterval, LicenseDetail, ValidationStatus } from '@/types';

interface HistoryResponse {
  activations: Array<{
    id: number;
    activationType: string;
    success: boolean;
    failureReason: string | null;
    ip: string | null;
    createdAt: string;
    device: { id: number; deviceName: string | null } | null;
  }>;
  validations: Array<{
    id: number;
    status: ValidationStatus;
    reason: string | null;
    appVersion: string | null;
    createdAt: string;
    device: { id: number; deviceName: string | null } | null;
  }>;
  auditLogs: Array<{
    id: number;
    action: string;
    adminEmail: string | null;
    createdAt: string;
  }>;
}

export function LicenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { confirm, confirmDialog } = useConfirm();

  const [renewOpen, setRenewOpen] = useState(false);
  const [renewInterval, setRenewInterval] = useState<BillingInterval>('YEARLY');
  const [renewPeriods, setRenewPeriods] = useState('1');

  const query = useQuery({
    queryKey: ['licenses', id],
    queryFn: () => api.get<LicenseDetail>(`/licenses/${id}`),
    enabled: Boolean(id),
  });

  const history = useQuery({
    queryKey: ['licenses', id, 'history'],
    queryFn: () => api.get<HistoryResponse>(`/licenses/${id}/history`),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['licenses', id] });
    queryClient.invalidateQueries({ queryKey: ['licenses'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  };

  const renew = useMutation({
    mutationFn: () =>
      api.post(`/licenses/${id}/renew`, {
        billingInterval: renewInterval,
        periods: Number(renewPeriods) || 1,
      }),
    onSuccess: () => {
      invalidate();
      toast.success('تم تجديد الترخيص', 'حُدِّث الاشتراك وكل التراخيص المرتبطة به');
      setRenewOpen(false);
    },
    onError: (error) => toast.error('تعذّر التجديد', (error as ApiError).friendlyMessage),
  });

  const runAction = async (action: string, label: string) => {
    try {
      await api.post(`/licenses/${id}/${action}`, {});
      invalidate();
      toast.success(label);
    } catch (error) {
      toast.error('تعذّر تنفيذ الإجراء', (error as ApiError).friendlyMessage);
    }
  };

  const resetDevice = (deviceId: number, deviceName: string | null) =>
    confirm(
      {
        title: 'إعادة تعيين الجهاز',
        description: `سيتم تحرير الجهاز "${deviceName ?? deviceId}" ليتمكن العميل من تفعيل جهاز آخر. تُسجَّل هذه العملية في سجل التدقيق.`,
        confirmLabel: 'إعادة التعيين',
        variant: 'destructive',
      },
      async () => {
        try {
          await api.post(`/licenses/${id}/reset-device`, { deviceId });
          invalidate();
          toast.success('تمت إعادة تعيين الجهاز');
        } catch (error) {
          toast.error('تعذّرت إعادة التعيين', (error as ApiError).friendlyMessage);
        }
      },
    );

  if (query.isLoading) return <LoadingState label="جارٍ تحميل بيانات الترخيص…" />;
  if (query.isError) {
    return (
      <ErrorState
        title="تعذّر تحميل الترخيص"
        description={(query.error as ApiError).friendlyMessage}
        onRetry={() => query.refetch()}
      />
    );
  }

  const license = query.data!;
  const isRevoked = license.derivedStatus === 'REVOKED';
  const isSuspended = license.derivedStatus === 'SUSPENDED';

  return (
    <div className="space-y-6">
      {confirmDialog}

      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">تفاصيل الترخيص</h1>
              <LicenseStatusBadge value={license.derivedStatus} showCode />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <code className="ltr select-all rounded bg-muted px-2 py-1 font-mono text-sm">
                {license.licenseKey}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  navigator.clipboard.writeText(license.licenseKey);
                  toast.success('تم نسخ المفتاح');
                }}
                aria-label="نسخ المفتاح"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {license.customer.company || license.customer.name} · {license.plan.nameAr || license.plan.name}
            </p>
          </div>
        </div>

        {/* Revoking is terminal, so the actions disappear once it happens. */}
        {!isRevoked && (
          <div className="flex flex-wrap gap-2">
            {can('licenses.update') && (
              <Button onClick={() => setRenewOpen(true)}>
                <RefreshCw />
                تجديد
              </Button>
            )}
            {can('licenses.suspend') && !isSuspended && (
              <Button
                variant="outline"
                onClick={() =>
                  confirm(
                    {
                      title: 'إيقاف الترخيص',
                      description: 'سيتوقف الترخيص فورًا عن العمل. يمكنك إعادة تفعيله لاحقًا في أي وقت، ويبقى في السجل.',
                      confirmLabel: 'إيقاف',
                    },
                    () => runAction('suspend', 'تم إيقاف الترخيص'),
                  )
                }
              >
                <Square />
                إيقاف
              </Button>
            )}
            {can('licenses.activate') && isSuspended && (
              <Button
                variant="outline"
                onClick={() =>
                  confirm(
                    {
                      title: 'إعادة تفعيل الترخيص',
                      description: 'سيعود الترخيص للعمل. إذا كانت مدته منتهية فسيعود بحالة "منتهي" لا "نشط".',
                      confirmLabel: 'إعادة التفعيل',
                    },
                    () => runAction('reactivate', 'تم إعادة التفعيل'),
                  )
                }
              >
                <Play />
                إعادة التفعيل
              </Button>
            )}
            {can('licenses.revoke') && (
              <Button
                variant="destructive"
                onClick={() =>
                  confirm(
                    {
                      title: 'إلغاء الترخيص نهائيًا',
                      description:
                        'لا يمكن التراجع. لن يعمل هذا المفتاح مرة أخرى، وستُلغى الأجهزة والاشتراك المرتبط. أصدر ترخيصًا جديدًا للعميل.',
                      confirmLabel: 'إلغاء نهائي',
                      variant: 'destructive',
                      requireTypedConfirmation: license.licenseKey,
                    },
                    () => runAction('revoke', 'تم إلغاء الترخيص'),
                  )
                }
              >
                <ShieldOff />
                إلغاء نهائي
              </Button>
            )}
          </div>
        )}

        {isRevoked && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            هذا الترخيص ملغى نهائيًا ولا يمكن إعادة تفعيله. أصدر ترخيصًا جديدًا مرتبطًا بالأصل.
          </div>
        )}
      </header>

      {/* Quick stats */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="الأيام المتبقية"
          value={daysRemainingLabel(license.daysRemaining)}
          hint={formatDate(license.expiresAt)}
          icon={RefreshCw}
        />
        <CountCard
          title="الأجهزة المستخدمة"
          count={license.activeDevices}
          icon={Monitor}
          hint={`${license.deviceSlotsFree} شاغر من ${license.maxDevices}`}
        />
        <StatCard
          title="آخر تحقق"
          value={license.lastValidationAt ? relativeTime(license.lastValidationAt) : 'لم يتحقق بعد'}
          icon={ShieldCheck}
        />
        <StatCard
          title="إصدار الترخيص"
          value={`v${license.version}`}
          hint={license.isTrial ? 'ترخيص تجريبي' : 'ترخيص مدفوع'}
          icon={Tag}
        />
      </section>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="devices">الأجهزة</TabsTrigger>
          <TabsTrigger value="activations">التفعيلات</TabsTrigger>
          <TabsTrigger value="validations">التحققات</TabsTrigger>
          <TabsTrigger value="audit">سجل التدقيق</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>بيانات الترخيص</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <KV label="الحالة المخزّنة" value={license.status} ltr />
                <KV label="الحالة الفعلية" value={license.derivedStatus} ltr />
                {license.statusReason && <KV label="السبب" value={license.statusReason} />}
                <KV label="البداية" value={formatDate(license.startsAt)} />
                <KV label="الانتهاء" value={formatDate(license.expiresAt)} />
                <KV label="الحد الأقصى للأجهزة" value={String(license.maxDevices)} />
                <KV label="تاريخ الإنشاء" value={formatDate(license.createdAt)} />
                <KV label="آخر ظهور" value={formatDateTime(license.lastSeenAt)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>الميزات المفعّلة</CardTitle>
                <CardDescription>تُوقَّع وتُرسل لتطبيق العميل</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {license.features?.length ? (
                    license.features.map((key) => (
                      <Badge key={key} variant="outline" className="ltr">
                        {key}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">لا توجد ميزات.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="devices">
          <Card>
            <CardHeader>
              <CardTitle>الأجهزة المسجّلة</CardTitle>
              <CardDescription>
                الحد الأقصى {license.maxDevices} — المستخدم {license.activeDevices}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الجهاز</TableHead>
                    <TableHead>النظام</TableHead>
                    <TableHead>إصدار التطبيق</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>آخر ظهور</TableHead>
                    <TableHead>إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {license.devices.map((device) => (
                    <TableRow key={device.id}>
                      <TableCell className="text-sm">{device.deviceName ?? '—'}</TableCell>
                      <TableCell className="ltr text-xs">
                        {device.platform ?? '—'} {device.osVersion ?? ''}
                      </TableCell>
                      <TableCell className="ltr text-xs">{device.appVersion ?? '—'}</TableCell>
                      <TableCell><DeviceStatusBadge value={device.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {device.lastSeenAt ? relativeTime(device.lastSeenAt) : '—'}
                      </TableCell>
                      <TableCell>
                        {device.status === 'ACTIVE' && can('devices.reset') && !isRevoked && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resetDevice(device.id, device.deviceName)}
                          >
                            إعادة تعيين
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activations">
          <Card>
            <CardHeader><CardTitle>سجل التفعيلات</CardTitle></CardHeader>
            <CardContent>
              {history.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : !history.data?.activations.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">لا يوجد تفعيلات بعد.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>النوع</TableHead>
                      <TableHead>الجهاز</TableHead>
                      <TableHead>النتيجة</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>التاريخ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.data.activations.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="ltr text-xs">{entry.activationType}</TableCell>
                        <TableCell className="text-sm">{entry.device?.deviceName ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={entry.success ? 'success' : 'destructive'}>
                            {entry.success ? 'نجح' : entry.failureReason ?? 'فشل'}
                          </Badge>
                        </TableCell>
                        <TableCell className="ltr text-xs">{entry.ip ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(entry.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="validations">
          <Card>
            <CardHeader>
              <CardTitle>سجل التحقق الدوري</CardTitle>
              <CardDescription>كل محاولة تحقق من تطبيق العميل</CardDescription>
            </CardHeader>
            <CardContent>
              {history.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : !history.data?.validations.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">لم يتحقق العميل بعد.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>النتيجة</TableHead>
                      <TableHead>الجهاز</TableHead>
                      <TableHead>إصدار التطبيق</TableHead>
                      <TableHead>التاريخ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.data.validations.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <ValidationStatusBadge value={entry.status} />
                        </TableCell>
                        <TableCell className="text-sm">{entry.device?.deviceName ?? '—'}</TableCell>
                        <TableCell className="ltr text-xs">{entry.appVersion ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(entry.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>سجل التدقيق</CardTitle>
              <CardDescription>سجل للقراءة فقط — لا يمكن تعديله من الواجهة</CardDescription>
            </CardHeader>
            <CardContent>
              {history.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : !history.data?.auditLogs.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">لا يوجد سجل بعد.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {history.data.auditLogs.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="ltr truncate text-xs font-medium">{entry.action}</p>
                        <p className="ltr truncate text-[11px] text-muted-foreground">
                          {entry.adminEmail ?? 'النظام'}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تجديد الترخيص</DialogTitle>
            <DialogDescription>
              سيُحدَّث تاريخ الانتهاء للترخيص وللاشتراك وكل التراخيص المرتبطة به في عملية واحدة.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              renew.mutate();
            }}
          >
            <div className="space-y-2">
              <Label>فترة التجديد</Label>
              <Select value={renewInterval} onValueChange={(value) => setRenewInterval(value as BillingInterval)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">شهري</SelectItem>
                  <SelectItem value="QUARTERLY">كل 3 أشهر</SelectItem>
                  <SelectItem value="YEARLY">سنوي</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>عدد الفترات</Label>
              <Input
                type="number"
                min="1"
                max="60"
                value={renewPeriods}
                onChange={(event) => setRenewPeriods(event.target.value)}
                dir="ltr"
                className="text-start"
              />
            </div>

            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              التاريخ الحالي: {formatDate(license.expiresAt)}. التجديد يُضاف إلى هذا التاريخ ولا يُلغيه،
              فالتجديد المبكر لا يقصّر المدة المدفوعة.
            </p>

            <DialogFooter>
              <Button type="submit" isLoading={renew.isPending}>تأكيد التجديد</Button>
              <Button type="button" variant="outline" onClick={() => setRenewOpen(false)}>إلغاء</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KV({ label, value, ltr }: { label: string; value?: string | null; ltr?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-end font-medium ${ltr ? 'ltr' : ''}`}>{value}</span>
    </div>
  );
}


