import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Input, Label, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import type { CustomerListItem, Paginated, Plan } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (id: number) => void;
}

/**
 * License issuance. The expiry date is derived server-side from the plan's
 * billing interval — the admin may override it, but never has to hand-pick it.
 */
export function CreateLicenseDialog({ open, onOpenChange, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [customerId, setCustomerId] = useState('');
  const [planId, setPlanId] = useState('');
  const [maxDevices, setMaxDevices] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');

  const customers = useQuery({
    queryKey: ['customers', { forLicense: true }],
    queryFn: () => api.get<Paginated<CustomerListItem>>('/customers', { limit: 100, status: 'ACTIVE' }),
    enabled: open,
  });

  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<{ data: Plan[] }>('/plans', { status: 'ACTIVE' }),
    enabled: open,
  });

  const selectedPlan = plans.data?.data.find((plan) => String(plan.id) === planId);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: number }>('/licenses', {
        customerId: Number(customerId),
        planId: Number(planId),
        maxDevices: maxDevices ? Number(maxDevices) : undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (license) => {
      queryClient.invalidateQueries({ queryKey: ['licenses'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      toast.success('تم إصدار الترخيص', 'المفتاح جاهز للإرسال للعميل');
      setCustomerId('');
      setPlanId('');
      setMaxDevices('');
      setExpiresAt('');
      setNotes('');
      onOpenChange(false);
      onSuccess?.(license.id);
    },
    onError: (error) => toast.error('تعذّر إصدار الترخيص', (error as ApiError).friendlyMessage),
  });

  const canSubmit = Boolean(customerId && planId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إصدار ترخيص جديد</DialogTitle>
          <DialogDescription>
            يتولّى الخادم توليد المفتاح وتوقيعه. المفتاح الخاص بالتوقيع لا يغادر الخادم أبدًا.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) create.mutate();
          }}
        >
          <Field label="العميل *">
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
              <SelectContent>
                {customers.data?.data.map((customer) => (
                  <SelectItem key={customer.id} value={String(customer.id)}>
                    {customer.company || customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="الخطة *">
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue placeholder="اختر الخطة" /></SelectTrigger>
              <SelectContent>
                {plans.data?.data.map((plan) => (
                  <SelectItem key={plan.id} value={String(plan.id)}>
                    {plan.nameAr || plan.name} ({plan.maxDevices} جهاز)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="الحد الأقصى للأجهزة">
            <Input type="number" min="1" value={maxDevices}
              onChange={(event) => setMaxDevices(event.target.value)}
              placeholder={selectedPlan ? String(selectedPlan.maxDevices) : 'افتراضي الخطة'}
              dir="ltr" className="text-start" />
          </Field>

          <Field label="تاريخ الانتهاء (اختياري)">
            <Input type="date" value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)} dir="ltr" className="text-start" />
            <p className="text-xs text-muted-foreground">
              اتركه فارغًا ليحسبه الخادم تلقائيًا حسب فترة الفوترة في الخطة.
            </p>
          </Field>

          <Field label="ملاحظات داخلية">
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>

          <DialogFooter>
            <Button type="submit" isLoading={create.isPending} disabled={!canSubmit}>
              إصدار الترخيص
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
