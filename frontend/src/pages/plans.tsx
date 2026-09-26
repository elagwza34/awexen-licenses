import { useQuery } from '@tanstack/react-query';
import { Boxes, KeyRound, Monitor, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/state';
import { BillingIntervalBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import type { Feature, Plan } from '@/types';
import { PlanFormDialog } from './plan-form-dialog';

export function PlansPage() {
  const { can } = useAuth();
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

  return (
    <div className="space-y-4">
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
      ) : !plans.data?.data.length ? (
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
          {plans.data.data.map((plan) => (
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

              {can('plans.update') && (
                <div className="border-t border-border p-4">
                  <Button variant="outline" size="sm" onClick={() => setEditing(plan)}>
                    <Pencil />
                    تعديل
                  </Button>
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
