import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import { PMS_FEATURE_LABELS, pmsFeatureRequirements, validatePmsSelection } from '@/lib/pms-plan-features';

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
  setupFee: string;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: string;
  maxDevices: string;
  maxUsers: string; maxBranches: string; maxWarehouses: string; enforceEntitlements: boolean;
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
    setupFee: String((plan?.setupFee ?? 0) / 100),
    currency: plan?.currency ?? 'EGP',
    billingInterval: plan?.billingInterval ?? 'MONTHLY',
    trialDays: String(plan?.trialDays ?? 0),
    maxDevices: String(plan?.maxDevices ?? 1),
    maxUsers: String(plan?.maxUsers ?? 2), maxBranches: String(plan?.maxBranches ?? 1), maxWarehouses: String(plan?.maxWarehouses ?? 1), enforceEntitlements: true,
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
  useEffect(() => {
    if (open) {
      setForm(toFormState(plan));
      setSelected(plan?.features?.map((f) => f.feature.id) ?? []);
    }
  }, [open, plan]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        key: form.key.trim().toUpperCase(),
        name: form.name.trim(),
        nameAr: form.nameAr?.trim() || undefined,
        description: form.description?.trim() || undefined,
        price: Math.round(Number(form.price) * 100),
        setupFee: Math.round(Number(form.setupFee) * 100),
        currency: form.currency.trim().toUpperCase(),
        billingInterval: form.billingInterval,
        trialDays: Number(form.trialDays) || 0,
        maxDevices: Number(form.maxDevices) || 1,
        maxUsers: Number(form.maxUsers), maxBranches: Number(form.maxBranches), maxWarehouses: Number(form.maxWarehouses), enforceEntitlements: form.enforceEntitlements,
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

  const selectedKeys = selected.map(id => features.find(feature => feature.id === id)?.key ?? '__UNKNOWN__');
  const selectionError = validatePmsSelection(selectedKeys, Number(form.maxBranches), Number(form.maxWarehouses));

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
            العميل يحصل على المميزات المختارة فقط بعد اعتماد اشتراكه وتفعيل الترخيص. المميزات غير المختارة تُغلق في التطبيق والخادم، مع استمرار تطبيق صلاحيات المستخدمين.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (selectionError) { toast.error('راجع مميزات الخطة', selectionError); return; }
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
            <Field label="رسوم التفعيل لأول مرة">
              <Input type="number" step="0.01" min="0" value={form.setupFee} onChange={(e) => setForm({ ...form, setupFee: e.target.value })} dir="ltr" />
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
                  <label key={feature.id} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input type="checkbox" checked={selected.includes(feature.id)}
                      disabled={!Object.prototype.hasOwnProperty.call(PMS_FEATURE_LABELS, feature.key) && !selected.includes(feature.id)}
                      onChange={() => toggleFeature(feature.id)} className="h-4 w-4 rounded border-input" />
                    <span>{feature.nameAr || feature.name}
                      {!Object.prototype.hasOwnProperty.call(PMS_FEATURE_LABELS, feature.key)
                        ? <small className="block text-destructive">غير مدعومة في PMS الحالي</small>
                        : pmsFeatureRequirements(feature.key) && <small className="block text-muted-foreground">تحتاج: {pmsFeatureRequirements(feature.key)}</small>}
                    </span>
                    <span className="ltr text-[10px] text-muted-foreground">{feature.key}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
          {([['maxUsers','المستخدمون النشطون'],['maxBranches','الفروع النشطة'],['maxWarehouses','المخازن النشطة']] as const).map(([key,label])=><div key={key}><Label>{label}</Label><Input type="number" min="1" value={form[key]} onChange={event=>setForm({...form,[key]:event.target.value})}/></div>)}
        </div>
        <p className="text-sm">تُطبّق مميزات وحدود هذه الخطة تلقائيًا داخل PMS.</p>
        {plan && !plan.enforceEntitlements && <p className="text-sm text-destructive">هذه خطة قديمة غير مقيّدة. حفظها يفعّل المميزات والحدود المختارة على تراخيصها عند تحديث الترخيص.</p>}
        {selectionError && <p role="alert" className="text-sm text-destructive">{selectionError}</p>}
        <p className="text-xs text-muted-foreground">الاشتراك الجديد يأخذ المميزات عند التفعيل. تعديل الخطة يصل إلى الأجهزة بعد تحديث الترخيص عبر الإنترنت؛ الأجهزة غير المتصلة تحتفظ بالتصريح السابق حتى نهاية صلاحيته. حدود المستخدمين والفروع والمخازن لكل شركة، والأجهزة لها حد مستقل.</p>
        <DialogFooter>
            <Button type="submit" isLoading={save.isPending} disabled={Boolean(selectionError) || features.length === 0}>
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
