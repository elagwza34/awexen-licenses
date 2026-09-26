import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/state';
import { formatNumber } from '@/lib/utils';

type Tone = 'default' | 'warning' | 'destructive' | 'success';

const TONE_CLASS: Record<Tone, string> = {
  default: 'bg-primary/10 text-primary',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  success: 'bg-success/15 text-success',
};

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  loading,
  error,
  to,
  tone = 'default',
}: {
  title: string;
  /** Pre-formatted string (e.g. currency) — pass undefined while loading. */
  value?: string;
  hint?: string;
  icon: React.ElementType;
  loading?: boolean;
  error?: boolean;
  to?: string;
  tone?: Tone;
}) {
  const body = (
    <Card className={to ? 'h-full transition-colors hover:border-primary/50' : 'h-full'}>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : error ? (
            <p className="mt-1 text-sm text-destructive">—</p>
          ) : (
            <p className="mt-1 truncate text-2xl font-bold">{value ?? '—'}</p>
          )}
          {!loading && !error && hint && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
        <div className={`shrink-0 rounded-lg p-2 ${TONE_CLASS[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );

  return to ? <Link to={to} className="block">{body}</Link> : body;
}

/** Count-only card for licence health buckets. */
export function CountCard({
  title,
  count,
  icon: Icon,
  loading,
  error,
  to,
  tone = 'default',
  hint,
}: {
  title: string;
  count?: number;
  icon: React.ElementType;
  loading?: boolean;
  error?: boolean;
  to?: string;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <StatCard
      title={title}
      value={count === undefined ? undefined : formatNumber(count)}
      icon={Icon}
      loading={loading}
      error={error}
      to={to}
      tone={tone}
      hint={hint}
    />
  );
}
