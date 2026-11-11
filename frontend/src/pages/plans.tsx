import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, KeyRound, Monitor, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/state';
import { BillingIntervalBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import type { Feature, Plan } from '@/types';
import { PlanFormDialog } from './plan-form-dialog';

export function PlansPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);

  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<{ data: Plan[] }>('/plans'),
  });

  const features = useQuery({
    queryKey: ['features'],
    queryFn: () => api.get<{ data: Feature[] }>('/features'),
    enabled: creating || editing !== null,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete<{ deleted: boolean; archived: boolean }>(`/plans/${id}`),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success(result.archived ? 'تمت إزالة الخطة من البيع' : 'تم حذف الخطة',
        result.archived ? 'حُفظت بالأرشيف للحفاظ على تراخيص العملاء والاشتراكات والمدفوعات المرتبطة.' : undefined);
    },
    onError: (error) => toast.error('تعذّر الحذف', (error as ApiError).friendlyMessage),
  });
  const visiblePlans = plans.data?.data.filter(plan => showArchived || plan.status !== 'ARCHIVED') ?? [];

  return (
    <div className="space-y-4">
      {confirmDialog}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">الخطط</h1>
          <p className="text-sm text-muted-foreground">
            الباقات المتاحة للبيع والميزات الممنوحة في كل باقة
          </p>
        </div>
        {can('plans.create') && (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            خطة جديدة
          </Button>
        )}
      </header>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
        إظهار الخطط المؤرشفة
      </label>

      {plans.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full" />
          ))}
        </div>
      ) : plans.isError ? (
        <ErrorState
          title="تعذّر تحميل الخطط"
          description={(plans.error as ApiError).friendlyMessage}
          onRetry={() => plans.refetch()}
        />
      ) : !visiblePlans.length ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title="لا توجد خطط بعد"
            description="أنشئ أول خطة وحدّد الميزات التي تشملها لتبدأ في إصدار التراخيص."
            action={
              can('plans.create') ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus />
                  خطة جديدة
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {visiblePlans.map((plan) => (
            <Card key={plan.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle>{plan.nameAr || plan.name}</CardTitle>
                    <CardDescription className="ltr">{plan.key}</CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {plan.isPopular && <Badge>الأكثر طلبًا</Badge>}
                    {plan.status === 'ARCHIVED' && <Badge variant="muted">مؤرشف</Badge>}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex-1 space-y-4">
                <div>
                  <p className="text-2xl font-bold">
                    {formatMoney(plan.price, plan.currency)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <BillingIntervalBadge value={plan.billingInterval} />
                    <Badge variant="secondary">
                      <Monitor className="h-3 w-3" />
                      {plan.maxDevices} جهاز
                    </Badge>
                    {plan.enforceEntitlements && <><Badge variant="muted">{plan.maxUsers} مستخدم</Badge><Badge variant="muted">{plan.maxBranches} فرع</Badge><Badge variant="muted">{plan.maxWarehouses} مخزن</Badge></>}
                      {plan.trialDays > 0 && <Badge variant="muted">تجربة {plan.trialDays} يوم</Badge>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    الميزات الممنوحة
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.featureKeys?.length ? (
                      plan.featureKeys.map((key) => (
                        <Badge key={key} variant="outline" className="ltr">
                          <KeyRound className="h-3 w-3" />
                          {key}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">لا توجد ميزات محدّدة</span>
                    )}
                  </div>
                </div>
              </CardContent>

              {(can('plans.update') || can('plans.delete')) && (
                <div className="flex gap-2 border-t border-border p-4">
                  {can('plans.update') && (
                  <Button variant="outline" size="sm" onClick={() => setEditing(plan)}>
                    <Pencil />
                    تعديل
                  </Button>
                  )}
                  {can('plans.delete') && (
                    <Button variant="destructive" size="sm" disabled={remove.isPending}
                      isLoading={remove.isPending && remove.variables === plan.id}
                      onClick={() => confirm({ title: 'حذف الخطة',
                        description: `هل تريد حذف «${plan.nameAr || plan.name}»؟ الخطة غير المرتبطة تُحذف نهائيًا. إن كانت مرتبطة بترخيص أو اشتراك أو دفعة، تُؤرشف وتُزال من البيع مع بقاء حقوق العملاء وسجلاتهم.`,
                        confirmLabel: 'حذف الخطة', variant: 'destructive' }, () => remove.mutate(plan.id))}>
                      <Trash2 /> حذف
                    </Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <PlanFormDialog
        open={creating || editing !== null}
        plan={editing}
        features={features.data?.data ?? []}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
    </div>
  );
}
