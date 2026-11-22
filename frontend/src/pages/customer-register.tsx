import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { setPortalToken, type PortalPlan } from '@/lib/portal-api';
import { money } from '@/lib/portal-format';
import { checkoutDestination, parseBillingInterval } from '@/lib/checkout-selection';
import { AlertCircle, Eye, EyeOff, KeyRound } from 'lucide-react';
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
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const planKey = search.get('plan') || undefined;
  const catalogue = useQuery({ queryKey: ['public', 'plans'], queryFn: () => api.get<{plans: PortalPlan[]}>('/portal/public-catalogue'), enabled: Boolean(planKey) });
  const selected = catalogue.data?.plans.find(p => p.key === planKey);
  const interval = parseBillingInterval(search.get('billingInterval'));
  const option = selected?.billingOptions.find(p => p.billingInterval === interval);
  const destination = checkoutDestination(option ? selected : undefined, interval ?? 'MONTHLY');


  const {
    register,
    handleSubmit,
    watch,
    getValues,
    trigger,
    setValue,
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

  const [code, setCode] = useState('');
  const email = watch('email').trim().toLowerCase();
  const requestCode = useMutation({
    mutationFn: (address: string) => api.post('/portal/register/code', { email: address }),
    onSuccess: () => setCode(''),
  });
  const codeRequested = requestCode.isSuccess && requestCode.variables === email;

  const mutation = useMutation({
    mutationFn: (values: RegisterValues) =>
      api.post<RegisterResponse>('/portal/register', {
        planKey,
        email: values.email,
        name: values.name,
        company: values.company || undefined,
        phone: values.phone || undefined,
        country: values.country || undefined,
        password: values.password,
        verificationCode: code,
      }),
    onSuccess: (result) => {
      setPortalToken(result.accessToken);
      navigate(destination, { replace: true });
    },
  });



  return (
    <RegisterForm
      selection={selected && option ? `${selected.nameAr ?? selected.name} · ${money(option.price, selected.currency)} ${interval === 'YEARLY' ? 'سنوياً' : 'شهرياً'} + ${money(selected.setupFee, selected.currency)} تفعيل لأول مرة` : planKey ? (catalogue.isError ? 'تعذّر تحميل الخطة. أعد تحميل الصفحة للمحاولة.' : catalogue.data ? 'الخطة أو المدة غير متاحة. اختر من الباقات الحالية.' : 'جاري مراجعة الخطة المختارة…') : undefined}
      loginDestination={planKey && !option ? undefined : destination}
      register={register}
      handleSubmit={handleSubmit}
      errors={errors}
      onSubmit={(v) => mutation.mutate(v)}
      error={
        requestCode.isError
          ? requestCode.error instanceof ApiError
            ? requestCode.error.friendlyMessage
            : 'تعذّر إرسال كود التفعيل. حاول مرة أخرى.'
          : mutation.isError
          ? mutation.error instanceof ApiError
            ? mutation.error.friendlyMessage
            : 'تعذّر إنشاء الحساب. حاول مرة أخرى.'
          : null
      }
      pending={mutation.isPending}
      selectionBlocked={Boolean(planKey && (!selected || !option))}
      code={code}
      codeRequested={codeRequested}
      onCodeChange={setCode}
      codePending={requestCode.isPending}
      onRequestCode={async () => {
        const address = getValues('email').trim().toLowerCase();
        setValue('email', address);
        if (await trigger('email')) {
          mutation.reset();
          requestCode.mutate(address);
        }
      }}
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
  selectionBlocked: boolean;
  selection?: string;
  loginDestination?: string;
  code: string;
  codeRequested: boolean;
  codePending: boolean;
  onCodeChange: (code: string) => void;
  onRequestCode: () => void;
};

function RegisterForm({ register, handleSubmit, errors, onSubmit, error, pending, selectionBlocked, selection, loginDestination, code, codeRequested, codePending, onCodeChange, onRequestCode }: RegisterProps) {
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
            {selection && <p className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm" role="status">{selection}</p>}
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

              <Button type="button" variant="outline" onClick={onRequestCode} isLoading={codePending} disabled={pending}>
                {codeRequested ? 'إعادة إرسال الكود' : 'إرسال كود التفعيل'}
              </Button>
              {codeRequested && (
                <div className="space-y-2">
                  <Label htmlFor="verification-code">كود التفعيل من البريد الإلكتروني</Label>
                  <Input id="verification-code" value={code} dir="ltr" inputMode="numeric"
                    autoComplete="one-time-code" maxLength={6}
                    onChange={(event) => onCodeChange(event.target.value.replace(/[^0-9]/g, ''))} />
                  <p className="text-xs text-muted-foreground">الكود 6 أرقام وصالح لمدة 10 دقائق.</p>
                </div>
              )}

              <Button type="submit" className="w-full" isLoading={pending}
                disabled={selectionBlocked || codePending || !codeRequested || code.length !== 6}>
                إنشاء الحساب
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          لديك حساب بالفعل؟{' '}
          {loginDestination ? <Link to="/portal/login" state={{ from: loginDestination }} className="font-medium text-primary underline">
            تسجيل الدخول
          </Link> : <span aria-disabled="true" className="text-muted-foreground">تسجيل الدخول</span>}
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
            className="text-start pr-10"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
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
            className="text-start pr-10"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
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
