import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { Paginated } from '@/types';

interface AuditRow {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  createdAt: string;
  admin?: { id: number; name: string; email: string } | null;
  adminEmail: string | null;
}

const ENTITY_LABELS: Record<string, string> = {
  LICENSE: 'ترخيص', CUSTOMER: 'عميل', PAYMENT: 'دفعة', SUBSCRIPTION: 'اشتراك',
  DEVICE: 'جهاز', PLAN: 'خطة', ADMIN: 'مدير', SETTING: 'إعداد',
  APP_VERSION: 'إصدار', SUPPORT_TICKET: 'تذكرة', FEATURE: 'ميزة',
};

export function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');

  const query = useQuery({
    queryKey: ['audit-logs', { page, search, entity }],
    queryFn: () =>
      api.get<Paginated<AuditRow>>('/audit-logs', {
        page, limit: 25, search: search || undefined, entity: entity || undefined,
      }),
  });

  const columns: Column<AuditRow>[] = [
    {
      key: 'action',
      header: 'الإجراء',
      cell: (row) => <span className="ltr text-xs font-medium">{row.action}</span>,
    },
    {
      key: 'entity',
      header: 'النوع',
      cell: (row) => (
        <div className="min-w-0">
          <Badge variant="secondary">{ENTITY_LABELS[row.entity] ?? row.entity}</Badge>
          {row.entityId && <p className="ltr mt-0.5 text-[11px] text-muted-foreground">#{row.entityId}</p>}
        </div>
      ),
    },
    {
      key: 'admin',
      header: 'المستخدم',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.admin?.name ?? row.adminEmail ?? 'النظام'}</p>
          <p className="ltr truncate text-[11px] text-muted-foreground">{row.ip ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'التوقيت',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">سجل التدقيق</h1>
        <p className="text-sm text-muted-foreground">
          سجل للقراءة فقط — لا يمكن تعديله أو حذفه من الواجهة
        </p>
      </header>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        isLoading={query.isLoading}
        error={query.isError ? (query.error as ApiError)?.friendlyMessage : undefined}
        onRetry={() => query.refetch()}
        page={page}
        totalPages={query.data?.meta.totalPages ?? 1}
        total={query.data?.meta.total ?? 0}
        onPageChange={setPage}
        search={search}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        searchPlaceholder="ابحث بالإجراء أو المستخدم…"
        emptyTitle="السجل فارغ"
        emptyDescription="كل عملية مهمة في اللوحة تُسجَّل هنا تلقائيًا."
        toolbar={
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(ENTITY_LABELS).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={entity === value ? 'default' : 'outline'}
                onClick={() => { setEntity(value); setPage(1); }}
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />
    </div>
  );
}
