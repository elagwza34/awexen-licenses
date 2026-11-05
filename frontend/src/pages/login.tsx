import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, Shield } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';

/**
 * Client-side validation mirrors the server DTOs. This is for fast feedback
 * only — the backend re-validates everything.
 */
const loginSchema = z.object({
  email: z.string().min(1, 'البريد الإلكتروني مطلوب').email('صيغة البريد الإلكتروني غير صحيحة'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
  totpCode: z
    .string()
    .optional()
    .refine((value) => !value || /^\d{6}$/.test(value), 'رمز التحقق يجب أن يكون 6 أرقام'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', totpCode: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      await login(values.email, values.password, values.totpCode || undefined);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.friendlyMessage
          : 'تعذّر الاتصال بالخادم. تحقّق من الشبكة وحاول مرة أخرى.',
      );
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Shield className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">لوحة تحكم المالك</h1>
            <p className="ltr text-sm text-muted-foreground">Owner Control Panel</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>تسجيل الدخول</CardTitle>
            <CardDescription>هذه اللوحة مخصصة لمالك النظام ومديريه فقط.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              {serverError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{serverError}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">البريد الإلكتروني</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="owner@company.com"
                  dir="ltr"
                  className="text-start"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">كلمة المرور</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    dir="ltr"
                    className="text-start pr-10"
                    aria-invalid={Boolean(errors.password)}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="totpCode">
                  رمز التحقق بخطوتين{' '}
                  <span className="text-xs font-normal text-muted-foreground">(اختياري)</span>
                </Label>
                <Input
                  id="totpCode"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  dir="ltr"
                  className="text-start tracking-[0.3em]"
                  {...register('totpCode')}
                />
                {errors.totpCode && <p className="text-xs text-destructive">{errors.totpCode.message}</p>}
              </div>

              <Button type="submit" className="w-full" isLoading={isSubmitting}>
                دخول
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          كل محاولات الدخول تُسجَّل في سجل التدقيق.
        </p>
      </div>
    </div>
  );
}
