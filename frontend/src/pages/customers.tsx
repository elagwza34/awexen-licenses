import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Mail, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { CustomerStatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { CustomerListItem, CustomerStatus, Paginated } from '@/types';
import { CustomerFormDialog } from './customer-form-dialog';

const PAGE_SIZE = 20;

export function CustomersPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CustomerStatus | ''>('');
  const [formOpen, setFormOpen] = useState(false);

  const query = useQuery({
    queryKey: ['customers', { page, search, status }],
    queryFn: () =>
      api.get<Paginated<CustomerListItem>>('/customers', {
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        status: status || undefined,
      }),
  });

  const columns: Column<CustomerListItem>[] = [
    {
      key: 'name',
      header: 'العميل',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.company || row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.name}</p>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'البريد الإلكتروني',
      cell: (row) => (
        <span className="ltr flex items-center gap-1.5 text-sm text-muted-foreground">
          <Mail className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{row.email}</span>
        </span>
      ),
    },
    {
      key: 'plan',
      header: 'الخطة الحالية',
      cell: (row) => {
        const license = row.licenses?.[0];
        return license ? (
          <span className="text-sm">{license.plan.nameAr || license.plan.name}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      key: 'counts',
      header: 'التراخيص / الاشتراكات',
      cell: (row) => (
        <div className="flex gap-1.5">
          <Badge variant="secondary">{row._count.licenses}</Badge>
          <Badge variant="muted">{row._count.subscriptions}</Badge>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (row) => <CustomerStatusBadge value={row.status} />,
    },
    {
      key: 'createdAt',
      header: 'تاريخ التسجيل',
      cell: (row) => <span className="text-sm text-muted-foreground">{formatDate(row.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">العملاء</h1>
          <p className="text-sm text-muted-foreground">
            كل العملاء المسجّلون في نظام الترخيص
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <UserPlus />
          عميل جديد
        </Button>
      </header>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        isLoading={query.isLoading}
        error={query.isError ? (query.error as ApiError)?.friendlyMessage : undefined}
        onRetry={() => query.refetch()}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        page={page}
        totalPages={query.data?.meta.totalPages ?? 1}
        total={query.data?.meta.total ?? 0}
        onPageChange={setPage}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="ابحث بالاسم أو البريد أو الهاتف…"
        emptyTitle="لا يوجد عملاء بعد"
        emptyDescription="ابدأ بإضافة أول عميل لإصدار أول ترخيص."
        toolbar={
          <div className="flex flex-wrap gap-1.5">
            {(['', 'ACTIVE', 'SUSPENDED', 'INACTIVE'] as const).map((value) => (
              <Button
                key={value || 'all'}
                size="sm"
                variant={status === value ? 'default' : 'outline'}
                onClick={() => {
                  setStatus(value as CustomerStatus | '');
                  setPage(1);
                }}
              >
                {value === '' ? 'الكل' : value === 'ACTIVE' ? 'نشط' : value === 'SUSPENDED' ? 'موقوف' : 'غير نشط'}
              </Button>
            ))}
          </div>
        }
      />

      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSuccess={(id) => navigate(`/customers/${id}`)}
      />
    </div>
  );
}
