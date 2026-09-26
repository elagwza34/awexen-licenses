import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a minor-unit integer (piasters/cents) as a currency string.
 * The API never sends floats, so no rounding drift is possible.
 */
export function formatMoney(amount: number, currency = 'EGP', locale = 'ar-EG'): string {
  const value = amount / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatNumber(value: number, locale = 'ar-EG'): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(value: string | Date | null | undefined, locale = 'ar-EG'): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined, locale = 'ar-EG'): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

/** "in 12 days" / "منذ 3 أيام" — used for expiries and last-seen times. */
export function relativeTime(value: string | Date | null | undefined, locale = 'ar-EG'): string {
  if (!value) return '—';
  const diffMs = new Date(value).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return rtf.format(0, 'minute');
}

export function daysRemainingLabel(days: number | null, locale = 'ar-EG'): string {
  if (days === null) return 'مدى الحياة';
  if (days <= 0) return 'منتهي';
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(days, 'day');
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
