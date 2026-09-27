/**
 * Shared formatting for the customer portal.
 *
 * Kept in one place so an amount is never rendered two different ways on two
 * different pages, which is exactly the sort of small inconsistency that makes
 * a customer doubt the figures.
 */

/** Prices are stored in minor units, so every amount is divided by 100 here. */
export const money = (value: number, currency: string) =>
  new Intl.NumberFormat('ar-EG-u-nu-latn', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100);

export const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' }).format(new Date(value))
    : '—';

export const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';

export const REQUEST_STATUS: Record<
  string,
  { label: string; variant: 'secondary' | 'success' | 'destructive' | 'outline' }
> = {
  PENDING: { label: 'بانتظار المراجعة', variant: 'outline' },
  VERIFIED: { label: 'تم الاعتماد', variant: 'success' },
  REJECTED: { label: 'مرفوض', variant: 'destructive' },
};
