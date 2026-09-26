import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import type { Customer } from '@/types';

const schema = z.object({
  name: z.string().min(2, 'الاسم مطلوب').max(160),
  company: z.string().max(160).optional(),
  email: z.string().email('صيغة البريد غير صحيحة').max(180),
  phone: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  country: z.string().max(80).optional(),
  taxNumber: z.string().max(60).optional(),
  notes: z.string().max(2000).optional(),
});

type FormValues = z.infer<typeof schema>;

export function CustomerFormDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {},
  });

  const createMutation = useMutation({
    mutationFn: (values: FormValues) => api.post<Customer>('/customers', values),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      toast.success('تمت إضافة العميل', customer.company || customer.name);
      reset();
      onOpenChange(false);
      onSuccess?.(customer.id);
    },
    onError: (error) => {
      toast.error('تعذّر إضافة العميل', (error as ApiError).friendlyMessage);
    },
  });

  const onSubmit = handleSubmit((values) => {
    // Strip empty strings so the API stores NULL rather than "".
    const payload = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== '' && value !== undefined),
    );
    createMutation.mutate(payload as FormValues);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>عميل جديد</DialogTitle>
          <DialogDescription>
            أضف بيانات العميل الأساسية. يمكن تعديلها لاحقًا في أي وقت.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم *" error={errors.name?.message}>
              <Input {...register('name')} aria-invalid={Boolean(errors.name)} />
            </Field>
            <Field label="الشركة" error={errors.company?.message}>
              <Input {...register('company')} />
            </Field>
            <Field label="البريد الإلكتروني *" error={errors.email?.message}>
              <Input type="email" dir="ltr" className="text-start" {...register('email')} aria-invalid={Boolean(errors.email)} />
            </Field>
            <Field label="الهاتف" error={errors.phone?.message}>
              <Input dir="ltr" className="text-start" {...register('phone')} />
            </Field>
            <Field label="المدينة" error={errors.city?.message}>
              <Input {...register('city')} />
            </Field>
            <Field label="الدولة" error={errors.country?.message}>
              <Input {...register('country')} />
            </Field>
            <Field label="الرقم الضريبي" error={errors.taxNumber?.message}>
              <Input dir="ltr" className="text-start" {...register('taxNumber')} />
            </Field>
          </div>

          <Field label="العنوان" error={errors.address?.message}>
            <Input {...register('address')} />
          </Field>

          <Field label="ملاحظات" error={errors.notes?.message}>
            <Textarea rows={3} {...register('notes')} />
          </Field>

          <DialogFooter>
            <Button type="submit" isLoading={createMutation.isPending} disabled={!can('customers.create')}>
              حفظ العميل
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
