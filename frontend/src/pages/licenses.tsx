import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { LicenseStatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { daysRemainingLabel, formatDate } from '@/lib/utils';
import type { LicenseListItem, LicenseStatus, Paginated } from '@/types';
import { CreateLicenseDialog } from './create-license-dialog';

const PAGE_SIZE = 20;

const STATUS_FILTERS: Array<{ value: LicenseStatus | ''; label: string }> = [
  { value: '', label: 'الكل' },
  { value: 'ACTIVE', label: 'نشط' },
  { value: 'TRIAL', label: 'تجريبي' },
  { value: 'EXPIRING', label: 'قارب الانتهاء' },
  { value: 'EXPIRED', label: 'منتهي' },
  { value: 'SUSPENDED', label: 'موقوف' },
  { value: 'REVOKED', label: 'ملغى' },
];

export function LicensesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LicenseStatus | ''>('');
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: ['licenses', { page, search, status }],
    queryFn: () =>
      api.get<Paginated<LicenseListItem>>('/licenses', {
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        status: status || undefined,
      }),
  });

  const columns: Column<LicenseListItem>[] = [
    {
      key: 'licenseKey',
      header: 'مفتاح الترخيص',
      cell: (row) => (
        <div className="min-w-0">
          <p className="ltr truncate font-mono text-xs">{row.licenseKey}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.customer.company || row.customer.name}
          </p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'الخطة',
      cell: (row) => <span className="text-sm">{row.plan.nameAr || row.plan.name}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      // derivedStatus is the server-computed truth; stored status may lag.
      cell: (row) => <LicenseStatusBadge value={row.derivedStatus || row.status} showCode />,
    },
    {
      key: 'devices',
      header: 'الأجهزة',
      cell: (row) => (
        <Badge variant={row.activeDevices >= row.maxDevices ? 'warning' : 'secondary'}>
          {row.activeDevices} / {row.maxDevices}
        </Badge>
      ),
    },
    {
      key: 'expiresAt',
      header: 'الانتهاء',
      cell: (row) => (
        <div className="min-w-0">
          <p className="text-sm">{formatDate(row.expiresAt)}</p>
          <p className="text-xs text-muted-foreground">{daysRemainingLabel(row.daysRemaining)}</p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">التراخيص</h1>
          <p className="text-sm text-muted-foreground">
            كل مفاتيح الترخيص الصادرة للعملاء وحالتها الفعلية
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          إصدار ترخيص
        </Button>
      </header>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        isLoading={query.isLoading}
        error={query.isError ? (query.error as ApiError)?.friendlyMessage : undefined}
        onRetry={() => query.refetch()}
        onRowClick={(row) => navigate(`/licenses/${row.id}`)}
        page={page}
        totalPages={query.data?.meta.totalPages ?? 1}
        total={query.data?.meta.total ?? 0}
        onPageChange={setPage}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="ابحث بمفتاح الترخيص أو اسم العميل…"
        emptyTitle="لا توجد تراخيص بعد"
        emptyDescription="أصدر أول ترخيص لعميل لتفعيل استخدام البرنامج."
        toolbar={
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value || 'all'}
                size="sm"
                variant={status === filter.value ? 'default' : 'outline'}
                onClick={() => {
                  setStatus(filter.value);
                  setPage(1);
                }}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        }
      />

      <CreateLicenseDialog
        open={creating}
        onOpenChange={setCreating}
        onSuccess={(id) => navigate(`/licenses/${id}`)}
      />
    </div>
  );
}
