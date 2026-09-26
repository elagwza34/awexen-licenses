import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { Paginated, SupportTicket } from '@/types';

const PAGE_SIZE = 20;

const TICKET_LABELS: Record<string, string> = {
  OPEN: 'مفتوح', IN_PROGRESS: 'قيد المعالجة', WAITING_CUSTOMER: 'بانتظار العميل',
  RESOLVED: 'تم الحل', CLOSED: 'مغلق',
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'منخفضة', MEDIUM: 'متوسطة', HIGH: 'عالية', URGENT: 'عاجلة',
};

const PRIORITY_VARIANTS: Record<string, 'muted' | 'secondary' | 'warning' | 'destructive'> = {
  LOW: 'muted', MEDIUM: 'secondary', HIGH: 'warning', URGENT: 'destructive',
};

export function SupportPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const query = useQuery({
    queryKey: ['support', { page, search, status }],
    queryFn: () =>
      api.get<Paginated<SupportTicket>>('/support', {
        page, limit: PAGE_SIZE, search: search || undefined, status: status || undefined,
      }),
  });

  const summary = useQuery({
    queryKey: ['support', 'summary'],
    queryFn: () => api.get<{ openTickets: number; data: Array<{ status: string; count: number }> }>('/support/summary'),
  });

  const columns: Column<SupportTicket>[] = [
    {
      key: 'number',
      header: 'الرقم',
      cell: (row) => <span className="ltr text-xs font-medium">{row.number}</span>,
    },
    {
      key: 'subject',
      header: 'الموضوع',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.subject}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.customer?.company || row.customer?.name}
          </p>
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'الأولوية',
      cell: (row) => (
        <Badge variant={PRIORITY_VARIANTS[row.priority] ?? 'secondary'}>
          {PRIORITY_LABELS[row.priority] ?? row.priority}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (row) => <Badge variant="outline">{TICKET_LABELS[row.status] ?? row.status}</Badge>,
    },
    {
      key: 'assignee',
      header: 'المسؤول',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.assignedAdmin?.name ?? 'غير مُسند'}</span>
      ),
    },
    {
      key: 'createdAt',
      header: 'التاريخ',
      cell: (row) => <span className="text-sm text-muted-foreground">{formatDate(row.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">الدعم الفني</h1>
        <p className="text-sm text-muted-foreground">تذاكر العملاء وملاحظات الفريق الداخلية</p>
      </header>

      {summary.data && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="warning">مفتوحة: {summary.data.openTickets}</Badge>
          {summary.data.data.map((entry) => (
            <Badge key={entry.status} variant="secondary">
              {TICKET_LABELS[entry.status] ?? entry.status}: {entry.count}
            </Badge>
          ))}
        </div>
      )}

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
        searchPlaceholder="ابحث بالرقم أو الموضوع…"
        emptyTitle="لا توجد تذاكر"
        emptyDescription="ستظهر هنا تذاكر دعم العملاء."
        toolbar={
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(TICKET_LABELS).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={status === value ? 'default' : 'outline'}
                onClick={() => { setStatus(value); setPage(1); }}
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
