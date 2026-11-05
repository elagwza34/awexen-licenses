import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, KeyRound, Loader2, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { portalApi, setPortalToken, type SessionResponse } from '@/lib/portal-api';
import { usePortalSession } from '@/hooks/use-portal';

type Mode = 'login' | 'register';

interface FormValues {
  name: string;
  email: string;
  password: string;
  company: string;
  phone: string;
}

/**
 * Customer sign-in and sign-up.
 *
 * One screen with two modes because the two forms share most of their fields,
 * and a customer who arrived intending to register should not have to hunt for
 * a different page to do it. The server validates everything again; this only
 * gives fast feedback.
 */
export function PortalLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = usePortalSession();
  const [mode, setMode] = useState<Mode>('login');

  // PortalRoute parks the page the customer wanted in `state.from`, so signing
  // in returns them to it instead of always dumping them on the overview. The
  // prefix check is what stops a crafted `from` from bouncing anyone out of
  // the portal and into the admin panel.
  const from = location.state as { from?: string } | null;
  const destination =
    from?.from?.startsWith('/portal') && from.from !== '/portal/login' ? from.from : '/portal';

  const form = useForm<FormValues>({
    defaultValues: { name: '', email: '', password: '', company: '', phone: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues): Promise<SessionResponse> => {
      if (mode === 'login') {
        return portalApi.login({ email: values.email, password: values.password });
      }
      return portalApi.register({
        name: values.name,
        email: values.email,
        password: values.password,
        company: values.company || undefined,
        phone: values.phone || undefined,
      });
    },
    onSuccess: (session) => {
      // Held in memory only. The portal issues no refresh cookie, so a reload
      // signs the customer out; that is deliberate for a machine that may be
      // shared, and re-entering the password is cheap.
      setPortalToken(session.accessToken);
      navigate(destination, { replace: true });
    },
  });

  const isRegister = mode === 'register';

  // Someone already holding a session has no business on the sign-in form.
  // Bouncing them here keeps the back button from parking them on a dead page.
  useEffect(() => {
    if (token) navigate(destination, { replace: true });
  }, [token, destination, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </div>
          <CardTitle className="text-xl">{isRegister ? 'إنشاء حساب جديد' : 'تسجيل الدخول'}</CardTitle>
          <CardDescription>
            {isRegister
              ? 'أنشئ حسابك لإدارة اشتراكك وطلب أكواد التفعيل.'
              : 'ادخل إلى لوحة حسابك لمتابعة اشتراكك وأكواد التفعيل.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            noValidate
          >
            {isRegister ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">الاسم</Label>
                  <Input id="name" {...form.register('name', { required: 'الاسم مطلوب' })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company">اسم الشركة (اختياري)</Label>
                  <Input id="company" {...form.register('company')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">رقم الهاتف (اختياري)</Label>
                  <Input id="phone" dir="ltr" {...form.register('phone')} />
                </div>
              </>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                {...form.register('email', { required: 'البريد الإلكتروني مطلوب' })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                dir="ltr"
                {...form.register('password', { required: 'كلمة المرور مطلوبة' })}
              />
              {isRegister ? (
                <p className="text-xs text-muted-foreground">
                  12 حرفاً على الأقل، وتحتوي حرفاً كبيراً وصغيراً ورقماً ورمزاً.
                </p>
              ) : null}
            </div>

            {mutation.isError ? (
              <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {mutation.error.message}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : isRegister ? <UserPlus /> : <LogIn />}
              {isRegister ? 'إنشاء الحساب' : 'دخول'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              {isRegister ? 'لديك حساب بالفعل؟' : 'ليس لديك حساب؟'}{' '}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => {
                  navigate(isRegister ? '/portal/login' : '/portal/register');
                  mutation.reset();
                }}
              >
                {isRegister ? 'سجّل الدخول' : 'أنشئ حساباً'}
              </button>
            </p>

            <p className="text-center text-xs">
              <Link to="/admin/login" className="text-muted-foreground hover:underline">
                دخول المالك
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
