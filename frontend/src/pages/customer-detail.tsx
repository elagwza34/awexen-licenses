import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Building2, KeyRound, LifeBuoy, Mail, Monitor, Phone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CountCard, StatCard } from '@/components/stat-card';
import { ErrorState, LoadingState } from '@/components/state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CustomerStatusBadge,
  LicenseStatusBadge,
  PaymentStatusBadge,
  SubscriptionStatusBadge,
} from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, relativeTime } from '@/lib/utils';
import type {
  Customer,
  LicenseStatus,
  PaymentStatus,
  SubscriptionStatus,
} from '@/types';

interface Subscription {
  id: number;
  status: SubscriptionStatus;
  price: number;
  currency: string;
  startsAt: string;
  expiresAt: string | null;
  plan: { name: string; nameAr: string | null };
}

interface LicenseRow {
  id: number;
  licenseKey: string;
  status: LicenseStatus;
  expiresAt: string | null;
  _count: { devices: number };
  plan: { name: string; nameAr: string | null };
}

interface PaymentRow {
  id: number;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method: string;
  paidAt: string | null;
}

interface TicketRow {
  id: number;
  number: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
}

export interface CustomerDetail extends Customer {
  requestedPlan?: { name: string; nameAr: string | null; billingInterval: string } | null;
  subscriptions: Subscription[];
  licenses: LicenseRow[];
  payments: PaymentRow[];
  tickets: TicketRow[];
  activationHistory: Array<{
    id: number;
    activationType: string;
    success: boolean;
    createdAt: string;
    license: { licenseKey: string };
  }>;
  auditLogs: Array<{
    id: number;
    action: string;
    adminEmail: string | null;
    createdAt: string;
  }>;
  stats: {
    activeLicenses: number;
    devices: number;
    totalPaid: number;
    paymentsCount: number;
    currentPlan: string | null;
    subscriptionExpiresAt: string | null;
    openTickets: number;
  };
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['customers', id],
    queryFn: () => api.get<CustomerDetail>(`/customers/${id}`),
    enabled: Boolean(id),
  });

  if (query.isLoading) return <LoadingState label="جارٍ تحميل بيانات العميل…" />;
  if (query.isError) {
    return (
      <ErrorState
        title="تعذّر تحميل العميل"
        description={(query.error as ApiError).friendlyMessage}
        onRetry={() => query.refetch()}
      />
    );
  }

  const customer = query.data!;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/customers')} aria-label="رجوع">
            <ArrowRight />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{customer.company || customer.name}</h1>
              <CustomerStatusBadge value={customer.status} showCode />
            </div>
            <p className="text-sm text-muted-foreground">{customer.name}</p>
            {customer.requestedPlan && <p className="mt-2 text-sm font-medium text-primary">الخطة المختارة عند التسجيل: {customer.requestedPlan.nameAr ?? customer.requestedPlan.name} · {customer.requestedPlan.billingInterval === 'YEARLY' ? 'سنوي' : 'شهري'}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="ltr flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />ID: {customer.id}
              </span>
              <span className="ltr flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                {customer.email}
              </span>
              {customer.phone && (
                <span className="ltr flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {customer.phone}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CountCard title="تراخيص نشطة" count={customer.stats.activeLicenses} icon={KeyRound} />
        <CountCard title="الأجهزة" count={customer.stats.devices} icon={Monitor} />
        <CountCard title="تذاكر مفتوحة" count={customer.stats.openTickets} icon={LifeBuoy} tone="warning" />
        <StatCard
          title="إجمالي المدفوع"
          value={formatMoney(customer.stats.totalPaid, 'EGP')}
          hint={`${customer.stats.paymentsCount} دفعة`}
          icon={KeyRound}
        />
      </section>

      <CustomerTabs customer={customer} navigate={navigate} />
    </div>
  );
}


function CustomerTabs({
  customer,
  navigate,
}: {
  customer: CustomerDetail;
  navigate: (path: string) => void;
}) {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
        <TabsTrigger value="subscriptions">الاشتراكات</TabsTrigger>
        <TabsTrigger value="licenses">التراخيص</TabsTrigger>
        <TabsTrigger value="payments">المدفوعات</TabsTrigger>
        <TabsTrigger value="support">الدعم</TabsTrigger>
        <TabsTrigger value="activity">النشاط</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>بيانات العميل</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="الاسم" value={customer.name} />
              <Row label="الشركة" value={customer.company} />
              <Row label="البريد الإلكتروني" value={customer.email} ltr />
              <Row label="الهاتف" value={customer.phone} ltr />
              <Row label="المدينة" value={customer.city} />
              <Row label="الدولة" value={customer.country} />
              <Row label="الرقم الضريبي" value={customer.taxNumber} ltr />
              <Row label="العنوان" value={customer.address} />
              <Row label="تاريخ التسجيل" value={formatDate(customer.createdAt)} />
              {customer.notes && <Row label="ملاحظات" value={customer.notes} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>الخطة الحالية</CardTitle>
              <CardDescription>ملخص الاشتراك النشط</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {customer.stats.currentPlan ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">الخطة</span>
                    <Badge>{customer.stats.currentPlan}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">تنتهي في</span>
                    <span>{formatDate(customer.stats.subscriptionExpiresAt)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">لا يوجد اشتراك نشط.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>


      <TabsContent value="subscriptions">
        <Card>
          <CardHeader><CardTitle>الاشتراكات</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الخطة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>السعر</TableHead>
                  <TableHead>البداية</TableHead>
                  <TableHead>الانتهاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customer.subscriptions.map((subscription) => (
                  <TableRow key={subscription.id}>
                    <TableCell>{subscription.plan.nameAr || subscription.plan.name}</TableCell>
                    <TableCell><SubscriptionStatusBadge value={subscription.status} /></TableCell>
                    <TableCell>{formatMoney(subscription.price, subscription.currency)}</TableCell>
                    <TableCell>{formatDate(subscription.startsAt)}</TableCell>
                    <TableCell>{formatDate(subscription.expiresAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="licenses">
        <Card>
          <CardHeader><CardTitle>التراخيص</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المفتاح</TableHead>
                  <TableHead>الخطة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الأجهزة</TableHead>
                  <TableHead>الانتهاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customer.licenses.map((license) => (
                  <TableRow key={license.id} className="cursor-pointer" onClick={() => navigate(`/licenses/${license.id}`)}>
                    <TableCell className="ltr font-mono text-xs">{license.licenseKey}</TableCell>
                    <TableCell>{license.plan.nameAr || license.plan.name}</TableCell>
                    <TableCell><LicenseStatusBadge value={license.status} /></TableCell>
                    <TableCell>{license._count.devices}</TableCell>
                    <TableCell>{formatDate(license.expiresAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>


      <TabsContent value="payments">
        <Card>
          <CardHeader><CardTitle>سجل المدفوعات</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الطريقة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ الدفع</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customer.payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{formatMoney(payment.amount, payment.currency)}</TableCell>
                    <TableCell className="ltr text-xs">{payment.method}</TableCell>
                    <TableCell><PaymentStatusBadge value={payment.status} /></TableCell>
                    <TableCell>{payment.paidAt ? formatDate(payment.paidAt) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="support">
        <Card>
          <CardHeader><CardTitle>تذاكر الدعم</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>الموضوع</TableHead>
                  <TableHead>الأولوية</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customer.tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="ltr text-xs">{ticket.number}</TableCell>
                    <TableCell>{ticket.subject}</TableCell>
                    <TableCell className="ltr text-xs">{ticket.priority}</TableCell>
                    <TableCell className="ltr text-xs">{ticket.status}</TableCell>
                    <TableCell>{formatDate(ticket.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>


      <TabsContent value="activity">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>سجل التفعيلات</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {customer.activationHistory.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="ltr text-xs">{entry.activationType}</p>
                      <p className="ltr truncate text-[11px] text-muted-foreground">{entry.license.licenseKey}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relativeTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>سجل التدقيق</CardTitle>
              <CardDescription>كل التغييرات على سجل هذا العميل</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {customer.auditLogs.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="ltr truncate text-xs">{entry.action}</p>
                      {entry.adminEmail && (
                        <p className="ltr truncate text-[11px] text-muted-foreground">{entry.adminEmail}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function Row({ label, value, ltr }: { label: string; value?: string | null; ltr?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-end font-medium ${ltr ? 'ltr' : ''}`}>{value}</span>
    </div>
  );
}
