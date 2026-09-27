import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Loader2, LogOut, Mail, MapPin, Phone, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { date } from '@/lib/portal-format';
import { setPortalToken } from '@/lib/portal-api';
import { portalApi } from '@/lib/portal-api';

/** One read-only row. */
function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium" dir={label === 'البريد الإلكتروني' ? 'ltr' : undefined}>
          {value || '—'}
        </p>
      </div>
    </div>
  );
}

/**
 * Read-only account details.
 *
 * Nothing is editable here on purpose: a customer changing their own email from
 * the portal would be a verified-contact address we can no longer rely on for
 * licence delivery. Changes go through support, which keeps one auditable path.
 */
export function PortalAccountPage() {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['portal', 'me'], queryFn: portalApi.me });

  if (me.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!me.data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          تعذّر تحميل بيانات الحساب.
        </CardContent>
      </Card>
    );
  }

  const customer = me.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">حسابي</h1>
        <p className="mt-1 text-sm text-muted-foreground">بياناتك الشخصية في النظام.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-5" />
            البيانات الشخصية
          </CardTitle>
          <Badge variant={customer.status === 'ACTIVE' ? 'success' : 'secondary'}>
            {customer.status === 'ACTIVE' ? 'حساب نشط' : customer.status}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field icon={User} label="الاسم" value={customer.name} />
          <Field icon={Mail} label="البريد الإلكتروني" value={customer.email} />
          <Field icon={Phone} label="الهاتف" value={customer.phone} />
          <Field icon={MapPin} label="الدولة" value={customer.country} />
          <Field icon={CalendarDays} label="تاريخ التسجيل" value={date(customer.createdAt)} />
          <Field
            icon={CalendarDays}
            label="آخر دخول"
            value={customer.lastLoginAt ? date(customer.lastLoginAt) : '—'}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">تعديل البيانات</CardTitle>
          <CardDescription>
            لتغيير البريد أو الهاتف راسل الدعم الفني — نحافظ على بريد موثوق لإرسال التراخيص.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="gap-2 text-destructive hover:text-destructive"
            onClick={() => {
              setPortalToken(null);
              navigate('/portal/login', { replace: true });
            }}
          >
            <LogOut className="size-4" />
            تسجيل الخروج
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
