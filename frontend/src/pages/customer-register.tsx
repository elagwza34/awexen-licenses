import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

/**
 * Customer self-registration.
 *
 * A customer fills this in to create their account. The row appears in the
 * owner's panel immediately, with downloadEnabled false, so nothing is
 * downloadable until the owner records payment. That is the whole point: the
 * customer can register immediately, but the 200MB installer stays behind the
 * payment gate.
 *
 * Client-side validation only gives fast feedback; the server re-validates
 * everything and its answer is the one that matters.
 */
const registerSchema = z
  .object({
    name: z.string().min(2, 'الاسم قصير جداً').max(160),
    email: z.string().min(1, 'البريد الإلكتروني مطلوب').email('بريد إلكتروني غير صحيح'),
    company: z.string().max(160).optional().or(z.literal('')),
    phone: z.string().min(1, 'رقم الهاتف مطلوب').max(40),
    country: z.string().max(80).optional().or(z.literal('')),
    password: z
      .string()
      .min(12, 'كلمة المرور 12 حرفاً على الأقل')
      .regex(/[a-z]/, 'يجب أن تحتوي على حرف صغير')
      .regex(/[A-Z]/, 'يجب أن تحتوي على حرف كبير')
      .regex(/\d/, 'يجب أن تحتوي على رقم')
      .regex(/[^\w\s]/, 'يجب أن تحتوي على رمز'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'كلمتا المرور غير متطابقتين',
    path: ['confirmPassword'],
  });

type RegisterValues = z.infer<typeof registerSchema>;

interface RegisterResponse {
  accessToken: string;
  customer: { id: number; email: string; name: string; downloadEnabled: boolean };
}

export function CustomerRegisterPage() {
  const [done, setDone] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      company: '',
      phone: '',
      country: '',
      password: '',
      confirmPassword: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: RegisterValues) =>
      api.post<RegisterResponse>('/portal/register', {
        email: values.email,
        name: values.name,
        company: values.company || undefined,
        phone: values.phone || undefined,
        country: values.country || undefined,
        password: values.password,
      }),
    onSuccess: (result) => setDone(result.customer.email),
  });

  if (done) return <RegisteredNotice email={done} />;

  return (
    <RegisterForm
      register={register}
      handleSubmit={handleSubmit}
      errors={errors}
      onSubmit={(v) => mutation.mutate(v)}
      error={
        mutation.isError
          ? mutation.error instanceof ApiError
            ? mutation.error.friendlyMessage
            : 'تعذّر إنشاء الحساب. حاول مرة أخرى.'
          : null
      }
      pending={mutation.isPending}
    />
  );
}

type RegisterProps = {
  register: ReturnType<typeof useForm<RegisterValues>>['register'];
  handleSubmit: ReturnType<typeof useForm<RegisterValues>>['handleSubmit'];
  errors: ReturnType<typeof useForm<RegisterValues>>['formState']['errors'];
  onSubmit: (values: RegisterValues) => void;
  error: string | null;
  pending: boolean;
};

function RegisterForm({ register, handleSubmit, errors, onSubmit, error, pending }: RegisterProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <KeyRound className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">نظام إدارة المبيعات</h1>
            <p className="ltr text-sm text-muted-foreground">PMS - Awexen</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>إنشاء حساب</CardTitle>
            <CardDescription>
              سجل بياناتك لاستلام نسخة النظام. الدفع يتم خارج المنصة، والتفعيل بعد تأكيده.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">الاسم</Label>
                  <Input id="name" placeholder="أحمد علي" aria-invalid={Boolean(errors.name)} {...register('name')} />
                  {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company">الشركة (اختياري)</Label>
                  <Input id="company" placeholder="شركة أحمد للتجارة" {...register('company')} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">البريد الإلكتروني</Label>
                  <Input
                    id="email"
                    type="email"
                    dir="ltr"
                    autoComplete="username"
                    placeholder="you@company.com"
                    className="text-start"
                    aria-invalid={Boolean(errors.email)}
                    {...register('email')}
                  />
                  {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">الهاتف</Label>
                  <Input id="phone" dir="ltr" placeholder="+20 100 000 0000" className="text-start" aria-invalid={Boolean(errors.phone)} {...register('phone', { required: 'رقم الهاتف مطلوب' })} />
                  {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">الدولة (اختياري)</Label>
                <Input id="country" placeholder="مصر" {...register('country')} />
              </div>

              <PasswordFields register={register} errors={errors} />

              <Button type="submit" className="w-full" isLoading={pending}>
                إنشاء الحساب
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          لديك حساب بالفعل؟{' '}
          <Link to="/portal/login" className="font-medium text-primary underline">
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}

type FieldErrors = ReturnType<typeof useForm<RegisterValues>>['formState']['errors'];

function PasswordFields({
  register,
  errors,
}: {
  register: ReturnType<typeof useForm<RegisterValues>>['register'];
  errors: FieldErrors;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="password">كلمة المرور</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            dir="ltr"
            autoComplete="new-password"
            className="text-start pe-10"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
          <button
            type="button"
            className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {errors.password ? (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            12 حرفاً على الأقل، مع حرف كبير وصغير ورقم ورمز.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">تأكيد كلمة المرور</Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            type={showConfirm ? 'text' : 'password'}
            dir="ltr"
            autoComplete="new-password"
            className="text-start pe-10"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
          <button
            type="button"
            className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            onClick={() => setShowConfirm((v) => !v)}
            tabIndex={-1}
            aria-label={showConfirm ? 'إخفاء تأكيد كلمة المرور' : 'إظهار تأكيد كلمة المرور'}
          >
            {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {errors.confirmPassword && (
          <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
        )}
      </div>
    </div>
  );
}

function RegisteredNotice({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/10">
            <CheckCircle2 className="h-7 w-7 text-green-600" />
          </div>
          <CardTitle>تم إنشاء حسابك</CardTitle>
          <CardDescription>
            حسابك جاهز على <span dir="ltr">{email}</span>، وهو الآن مسجّل في نظامنا.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium">الخطوات التالية</p>
            <ol className="mt-2 list-decimal space-y-1 pe-4 text-muted-foreground">
              <li>أكمل الدفع و/أو تواصل معنا لتأكيده.</li>
              <li>سنرسل لك كود الترخيص على بريدك الإلكتروني.</li>
              <li>
                سجّل الدخول لتحميل النسخة:
                <Link to="/portal/login" className="ms-1 font-medium text-primary underline">
                  تسجيل الدخول
                </Link>
              </li>
            </ol>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            التحميل يفتح بعد تأكيد الدفع فقط.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
