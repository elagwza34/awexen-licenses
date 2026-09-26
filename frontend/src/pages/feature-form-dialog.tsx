import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import type { Feature } from '@/types';

const CATEGORY_VALUES = ['CORE', 'INVENTORY', 'SALES', 'REPORTING', 'INTEGRATION', 'PLATFORM'] as const;

export function FeatureFormDialog({
  open,
  feature,
  onOpenChange,
}: {
  open: boolean;
  feature: Feature | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEdit = Boolean(feature);

  const [form, setForm] = useState({
    key: feature?.key ?? '',
    name: feature?.name ?? '',
    nameAr: feature?.nameAr ?? '',
    description: feature?.description ?? '',
    category: feature?.category ?? 'CORE',
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        key: form.key.trim().toUpperCase(),
        name: form.name.trim(),
        nameAr: form.nameAr.trim() || undefined,
        description: form.description.trim() || undefined,
        category: form.category,
      };
      return isEdit
        ? api.put<Feature>(`/features/${feature!.id}`, payload)
        : api.post<Feature>('/features', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['features'] });
      toast.success(isEdit ? 'تم تحديث الميزة' : 'تم إنشاء الميزة');
      onOpenChange(false);
    },
    onError: (error) => toast.error('تعذّر الحفظ', (error as ApiError).friendlyMessage),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'تعديل الميزة' : 'ميزة جديدة'}</DialogTitle>
          <DialogDescription>
            المفتاح ثابت ويُرسل موقّعًا لتطبيق العميل — لا يمكن تغييره بعد الاستخدام.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>المفتاح (EN) *</Label>
            <Input
              value={form.key}
              onChange={(event) => setForm({ ...form, key: event.target.value })}
              placeholder="MULTI_WAREHOUSE"
              dir="ltr"
              className="text-start font-mono"
              disabled={isEdit}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>الاسم (EN) *</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                dir="ltr"
                className="text-start"
              />
            </div>
            <div className="space-y-2">
              <Label>الاسم (AR)</Label>
              <Input
                value={form.nameAr}
                onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>التصنيف</Label>
            <Select value={form.category} onValueChange={(value) => setForm({ ...form, category: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>الوصف</Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="submit" isLoading={save.isPending} disabled={!form.key || !form.name}>
              {isEdit ? 'حفظ' : 'إنشاء'}
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
