import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { DeviceStatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/utils';
import type { Device, DeviceStatus, Paginated } from '@/types';

const PAGE_SIZE = 20;

const STATUS_FILTERS: Array<{ value: DeviceStatus | ''; label: string }> = [
  { value: '', label: 'الكل' },
  { value: 'ACTIVE', label: 'نشط' },
  { value: 'BLOCKED', label: 'محظور' },
  { value: 'REVOKED', label: 'ملغى' },
];

export function DevicesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DeviceStatus | ''>('');

  const query = useQuery({
    queryKey: ['devices', { page, search, status }],
    queryFn: () =>
      api.get<Paginated<Device>>('/devices', {
        page, limit: PAGE_SIZE, search: search || undefined, status: status || undefined,
      }),
  });

  const columns: Column<Device>[] = [
    {
      key: 'device',
      header: 'الجهاز',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.deviceName ?? 'جهاز بدون اسم'}</p>
          {/* Only a short prefix of the fingerprint hash is ever returned. */}
          <p className="ltr truncate font-mono text-[11px] text-muted-foreground">
            {row.deviceFingerprint}…
          </p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'العميل',
      cell: (row) => (
        <p className="truncate text-sm">
          {row.license?.customer?.company || row.license?.customer?.name || '—'}
        </p>
      ),
    },
    {
      key: 'platform',
      header: 'النظام',
      cell: (row) => (
        <span className="ltr text-xs">
          {row.platform ?? '—'} {row.osVersion ?? ''}
        </span>
      ),
    },
    {
      key: 'appVersion',
      header: 'إصدار التطبيق',
      cell: (row) => <span className="ltr text-xs">{row.appVersion ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (row) => <DeviceStatusBadge value={row.status} showCode />,
    },
    {
      key: 'lastSeen',
      header: 'آخر ظهور',
      cell: (row) => (
        <div>
          <p className="text-sm">{row.lastSeenAt ? relativeTime(row.lastSeenAt) : 'لم يظهر'}</p>
          <p className="text-xs text-muted-foreground">{formatDate(row.activatedAt)}</p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">الأجهزة</h1>
        <p className="text-sm text-muted-foreground">
          الأجهزة المسجّلة على التراخيص وحالة كل منها
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
        searchPlaceholder="ابحث باسم الجهاز أو العميل…"
        emptyTitle="لا توجد أجهزة بعد"
        emptyDescription="تظهر الأجهزة هنا بعد أول تحقّق من تطبيق العميل."
        toolbar={
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value || 'all'}
                size="sm"
                variant={status === filter.value ? 'default' : 'outline'}
                onClick={() => { setStatus(filter.value); setPage(1); }}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        }
      />
    </div>
  );
}
