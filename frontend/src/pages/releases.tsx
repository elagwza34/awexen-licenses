import { useQuery } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/state';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { AppVersion } from '@/types';

const STATUS_VARIANTS = {
  DRAFT: 'muted',
  PUBLISHED: 'success',
  DEPRECATED: 'destructive',
} as const;

const PLATFORM_LABELS: Record<string, string> = {
  WINDOWS: 'ويندوز', MACOS: 'ماك', LINUX: 'لينكس',
};

export function ReleasesPage() {
  const query = useQuery({
    queryKey: ['releases'],
    queryFn: () => api.get<{ data: AppVersion[]; meta: { total: number } }>('/releases', { limit: 50 }),
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">إصدارات التطبيق</h1>
        <p className="text-sm text-muted-foreground">
          الإصدارات المنشورة التي يراها تطبيق العميل عند التحقق — بدون تنزيل تلقائي
        </p>
      </header>

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          title="تعذّر تحميل الإصدارات"
          description={(query.error as ApiError)?.friendlyMessage}
          onRetry={() => query.refetch()}
        />
      ) : !query.data?.data.length ? (
        <Card>
          <EmptyState
            icon={Rocket}
            title="لا توجد إصدارات"
            description="أنشئ أول إصدار كمسودة، ثم انشره عندما يكون جاهزًا."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {query.data.data.map((version) => (
            <Card key={version.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="ltr text-lg">
                    {version.version} <span className="text-sm text-muted-foreground">({version.buildNumber})</span>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {PLATFORM_LABELS[version.platform] ?? version.platform} · {version.channel}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANTS[version.status]}>
                  {version.status === 'DRAFT'
                    ? 'مسودة'
                    : version.status === 'PUBLISHED'
                      ? 'منشور'
                      : 'مهجور'}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {version.isRequired && <Badge variant="warning">تحديث إجباري</Badge>}
                {version.minSupportedVersion && (
                  <p className="text-xs text-muted-foreground">
                    أقل إصدار مدعوم: <span className="ltr">{version.minSupportedVersion}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {version.releasedAt ? `نُشر في ${formatDate(version.releasedAt)}` : 'لم يُنشر بعد'}
                </p>
                {version.releaseNotes && (
                  <p className="line-clamp-3 text-xs text-muted-foreground">{version.releaseNotes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
