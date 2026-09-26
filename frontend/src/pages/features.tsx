import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/state';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { FeatureFormDialog } from './feature-form-dialog';
import type { Feature } from '@/types';

const CATEGORIES: Record<string, string> = {
  CORE: 'أساسي', INVENTORY: 'مخزون', SALES: 'مبيعات',
  REPORTING: 'تقارير', INTEGRATION: 'تكاملات', PLATFORM: 'منصة',
};

const STATUS_LABELS: Record<string, string> = {
  '': 'الكل', ACTIVE: 'نشط', DEPRECATED: 'مهمل',
};

export function FeaturesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { confirm, confirmDialog } = useConfirm();

  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Feature | null>(null);
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: ['features', status],
    queryFn: () => api.get<{ data: Feature[] }>('/features', status ? { status } : undefined),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['features'] });
    queryClient.invalidateQueries({ queryKey: ['plans'] });
  };

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/features/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('تم', 'إن كانت مستخدمة في خطة فقد أُهملت بدل حذفها');
    },
    onError: (error) => toast.error('تعذّر الحذف', (error as ApiError).friendlyMessage),
  });

  // Grouped by category so the list stays readable as the catalogue grows.
  const byCategory = new Map<string, Feature[]>();
  for (const feature of query.data?.data ?? []) {
    if (!byCategory.has(feature.category)) byCategory.set(feature.category, []);
    byCategory.get(feature.category)!.push(feature);
  }

  return (
    <div className="space-y-4">
      {confirmDialog}

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">الميزات</h1>
          <p className="text-sm text-muted-foreground">
            كتالوج الميزات الذي تبني عليه الخطط — المفتاح ثابت لأن تطبيق العميل يطابق عليه
          </p>
        </div>
        {can('features.create') && (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            ميزة جديدة
          </Button>
        )}
      </header>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <Button
            key={value || 'all'}
            size="sm"
            variant={status === value ? 'default' : 'outline'}
            onClick={() => setStatus(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-32 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          title="تعذّر تحميل الميزات"
          description={(query.error as ApiError).friendlyMessage}
          onRetry={() => query.refetch()}
        />
      ) : !query.data?.data.length ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="لا توجد ميزات"
            description="أضف الميزات التي يمكن منحها في الخطط."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {Array.from(byCategory.entries()).map(([category, features]) => (
            <div key={category}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                {CATEGORIES[category] ?? category}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {features.map((feature) => (
                  <FeatureCard
                    key={feature.id}
                    feature={feature}
                    canEdit={can('features.update')}
                    canDelete={can('features.delete')}
                    onEdit={() => setEditing(feature)}
                    onDelete={() =>
                      confirm(
                        {
                          title: 'حذف الميزة',
                          description: feature._count?.plans
                            ? `مستخدمة في ${feature._count.plans} خطة، سيتم إهمالها بدل حذفها.`
                            : 'سيتم حذفها نهائيًا.',
                          confirmLabel: 'حذف',
                          variant: 'destructive',
                        },
                        () => remove.mutate(feature.id),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <FeatureFormDialog
        open={creating || editing !== null}
        feature={editing}
        onOpenChange={(open) => {
          if (!open) { setCreating(false); setEditing(null); }
        }}
      />
    </div>
  );
}

function FeatureCard({
  feature, canEdit, canDelete, onEdit, onDelete,
}: {
  feature: Feature;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm">{feature.nameAr || feature.name}</CardTitle>
            <p className="ltr truncate text-[11px] text-muted-foreground">{feature.key}</p>
          </div>
          {feature.status === 'DEPRECATED' && <Badge variant="muted">مهمل</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2 pt-0">
        <Badge variant="secondary">{feature._count?.plans ?? 0} خطة</Badge>
        <div className="flex gap-1">
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label="تعديل">
              <Pencil />
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="ghost" onClick={onDelete} aria-label="حذف">
              <Trash2 />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
