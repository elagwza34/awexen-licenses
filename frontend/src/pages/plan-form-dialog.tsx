import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import type { BillingInterval, Feature, Plan } from '@/types';

const INTERVALS: BillingInterval[] = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME'];
const INTERVAL_LABELS: Record<BillingInterval, string> = {
  MONTHLY: 'شهري',
  QUARTERLY: 'كل 3 أشهر',
  YEARLY: 'سنوي',
  LIFETIME: 'مدى الحياة',
};

interface PlanFormProps {
  open: boolean;
  plan: Plan | null;
  features: Feature[];
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  key: string;
  name: string;
  nameAr?: string;
  description?: string;
  price: string;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: string;
  maxDevices: string;
  sortOrder: string;
}

function toFormState(plan: Plan | null): FormState {
  return {
    key: plan?.key ?? '',
    name: plan?.name ?? '',
    nameAr: plan?.nameAr ?? '',
    description: plan?.description ?? '',
    // stored as minor units, edited as major units
    price: plan ? String(plan.price / 100) : '0',
    currency: plan?.currency ?? 'EGP',
    billingInterval: plan?.billingInterval ?? 'MONTHLY',
    trialDays: String(plan?.trialDays ?? 0),
    maxDevices: String(plan?.maxDevices ?? 1),
    sortOrder: String(plan?.sortOrder ?? 0),
  };
}

/**
 * Plan editor. Prices are entered in major units and converted to minor units
 * before sending, because the API stores integers only.
 */
export function PlanFormDialog({ open, plan, features, onOpenChange }: PlanFormProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEdit = Boolean(plan);

  const [form, setForm] = useState<FormState>(() => toFormState(plan));
  const [selected, setSelected] = useState<number[]>(plan?.features?.map((f) => f.feature.id) ?? []);
  const [seededFor, setSeededFor] = useState<number | null>(plan?.id ?? null);

  // Re-seed the form when the dialog opens for a different plan.
  if (open && (plan?.id ?? null) !== seededFor) {
    setForm(toFormState(plan));
    setSelected(plan?.features?.map((f) => f.feature.id) ?? []);
    setSeededFor(plan?.id ?? null);
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        key: form.key.trim().toUpperCase(),
        name: form.name.trim(),
        nameAr: form.nameAr?.trim() || undefined,
        description: form.description?.trim() || undefined,
        price: Math.round(Number(form.price) * 100),
        currency: form.currency.trim().toUpperCase(),
        billingInterval: form.billingInterval,
        trialDays: Number(form.trialDays) || 0,
        maxDevices: Number(form.maxDevices) || 1,
        sortOrder: Number(form.sortOrder) || 0,
        featureIds: selected,
      };
      return isEdit ? api.put<Plan>(`/plans/${plan!.id}`, payload) : api.post<Plan>('/plans', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success(isEdit ? 'تم تحديث الخطة' : 'تم إنشاء الخطة');
      onOpenChange(false);
    },
    onError: (error) => toast.error('تعذّر الحفظ', (error as ApiError).friendlyMessage),
  });

  const toggleFeature = (id: number) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'تعديل الخطة' : 'خطة جديدة'}</DialogTitle>
          <DialogDescription>
            الميزات المختارة تُخزَّن كبيانات، ويقرأها تطبيق العميل من التوقيع المُفعَّل.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="المفتاح (EN) *">
              <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="PROFESSIONAL" dir="ltr" className="text-start font-mono" disabled={isEdit} />
            </Field>
            <Field label="الاسم (EN) *">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                dir="ltr" className="text-start" />
            </Field>
            <Field label="الاسم (AR)">
              <Input value={form.nameAr ?? ''} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
            </Field>
            <Field label="العملة *">
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                dir="ltr" className="text-start" maxLength={3} />
            </Field>
            <Field label="السعر *">
              <Input type="number" step="0.01" min="0" value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })} dir="ltr" className="text-start" />
            </Field>
            <Field label="فترة الفوترة *">
              <Select value={form.billingInterval}
                onValueChange={(value) => setForm({ ...form, billingInterval: value as BillingInterval })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((interval) => (
                    <SelectItem key={interval} value={interval}>{INTERVAL_LABELS[interval]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="أيام التجربة">
              <Input type="number" min="0" value={form.trialDays}
                onChange={(e) => setForm({ ...form, trialDays: e.target.value })} dir="ltr" className="text-start" />
            </Field>
            <Field label="الحد الأقصى للأجهزة">
              <Input type="number" min="1" value={form.maxDevices}
                onChange={(e) => setForm({ ...form, maxDevices: e.target.value })} dir="ltr" className="text-start" />
            </Field>
            <Field label="ترتيب العرض">
              <Input type="number" value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} dir="ltr" className="text-start" />
            </Field>
          </div>

          <Field label="الوصف">
            <Input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>

          <div className="space-y-2">
            <Label>الميزات الممنوحة ({selected.length})</Label>
            {features.length === 0 ? (
              <p className="text-xs text-muted-foreground">لا توجد ميزات معرّفة بعد.</p>
            ) : (
              <div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                {features.map((feature) => (
                  <label key={feature.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={selected.includes(feature.id)}
                      onChange={() => toggleFeature(feature.id)} className="h-4 w-4 rounded border-input" />
                    <span>{feature.nameAr || feature.name}</span>
                    <span className="ltr text-[10px] text-muted-foreground">{feature.key}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" isLoading={save.isPending}>
              {isEdit ? 'حفظ التعديلات' : 'إنشاء الخطة'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
