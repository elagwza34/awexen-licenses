import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, KeyRound, Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { portalApi, setPortalToken, type SessionResponse } from '@/lib/portal-api';
import { usePortalSession } from '@/hooks/use-portal';

interface FormValues {
  email: string;
  password: string;
}

/**
 * Customer sign-in. Sign-up lives on its own page at /portal/register so the
 * login screen stays a single-purpose form.
 */
export function PortalLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = usePortalSession();

  // PortalRoute parks the page the customer wanted in `state.from`, so signing
  // in returns them to it instead of always dumping them on the overview. The
  // prefix check is what stops a crafted `from` from bouncing anyone out of
  // the portal and into the admin panel.
  const from = location.state as { from?: string } | null;
  const destination =
    from?.from?.startsWith('/portal') && from.from !== '/portal/login' ? from.from : '/portal';

  const form = useForm<FormValues>({
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues): Promise<SessionResponse> =>
      portalApi.login({ email: values.email, password: values.password }),
    onSuccess: (session) => {
      // Held in memory only. The portal issues no refresh cookie, so a reload
      // signs the customer out; that is deliberate for a machine that may be
      // shared, and re-entering the password is cheap.
      setPortalToken(session.accessToken);
      navigate(destination, { replace: true });
    },
  });

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
          <CardTitle className="text-xl">تسجيل الدخول</CardTitle>
          <CardDescription>
            ادخل إلى لوحة حسابك لمتابعة اشتراكك وأكواد التفعيل.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            noValidate
          >
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
            </div>

            {mutation.isError ? (
              <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {mutation.error.message}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <LogIn />}
              دخول
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              ليس لديك حساب؟{' '}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => {
                  navigate('/portal/register');
                  mutation.reset();
                }}
              >
                أنشئ حساباً
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
