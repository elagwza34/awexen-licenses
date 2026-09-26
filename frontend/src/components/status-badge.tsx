import { Badge } from '@/components/ui/badge';
import type { BadgeVariant } from './badge-variants';
import {
  type BillingInterval,
  type CustomerStatus,
  type DeviceStatus,
  type LicenseStatus,
  type PaymentStatus,
  type SubscriptionStatus,
  type ValidationStatus,
} from '@/types';

type Entry = { label: string; variant: BadgeVariant };

/**
 * Arabic labels with the English enum kept alongside. The owner reads Arabic;
 * anything copied into a support ticket stays in English.
 */
const MAPS = {
  customerStatus: {
    ACTIVE: { label: 'نشط', variant: 'success' },
    INACTIVE: { label: 'غير نشط', variant: 'muted' },
    SUSPENDED: { label: 'موقوف', variant: 'destructive' },
  },
  licenseStatus: {
    ACTIVE: { label: 'نشط', variant: 'success' },
    TRIAL: { label: 'تجريبي', variant: 'default' },
    EXPIRING: { label: 'قارب على الانتهاء', variant: 'warning' },
    EXPIRED: { label: 'منتهي', variant: 'destructive' },
    SUSPENDED: { label: 'موقوف', variant: 'destructive' },
    REVOKED: { label: 'ملغى نهائيًا', variant: 'destructive' },
  },
  subscriptionStatus: {
    TRIAL: { label: 'تجريبي', variant: 'default' },
    ACTIVE: { label: 'نشط', variant: 'success' },
    PAST_DUE: { label: 'متأخر السداد', variant: 'warning' },
    EXPIRED: { label: 'منتهي', variant: 'destructive' },
    CANCELLED: { label: 'ملغى', variant: 'muted' },
    SUSPENDED: { label: 'موقوف', variant: 'destructive' },
  },
  deviceStatus: {
    ACTIVE: { label: 'نشط', variant: 'success' },
    BLOCKED: { label: 'محظور', variant: 'warning' },
    REVOKED: { label: 'ملغى', variant: 'destructive' },
  },
  paymentStatus: {
    PENDING: { label: 'معلق', variant: 'warning' },
    PAID: { label: 'مدفوع', variant: 'success' },
    FAILED: { label: 'فشل', variant: 'destructive' },
    REFUNDED: { label: 'مسترد', variant: 'muted' },
    CANCELLED: { label: 'ملغى', variant: 'muted' },
  },
  validationStatus: {
    SUCCESS: { label: 'ناجح', variant: 'success' },
    FAILED: { label: 'فشل', variant: 'destructive' },
    EXPIRED: { label: 'منتهي', variant: 'destructive' },
    SUSPENDED: { label: 'موقوف', variant: 'destructive' },
    INVALID: { label: 'غير صالح', variant: 'destructive' },
    DEVICE_LIMIT: { label: 'تجاوز حد الأجهزة', variant: 'warning' },
    REVOKED: { label: 'ملغى', variant: 'destructive' },
  },
  billingInterval: {
    MONTHLY: { label: 'شهري', variant: 'outline' },
    QUARTERLY: { label: 'ربع سنوي', variant: 'outline' },
    YEARLY: { label: 'سنوي', variant: 'outline' },
    LIFETIME: { label: 'مدى الحياة', variant: 'outline' },
  },
} satisfies Record<string, Record<string, Entry>>;

function StatusBadge<T extends string>({
  map,
  value,
  showCode = false,
  className,
}: {
  map: Record<string, Entry>;
  value: T;
  showCode?: boolean;
  className?: string;
}) {
  const entry = map[value] ?? { label: value, variant: 'muted' as const };
  return (
    <Badge variant={entry.variant} className={className}>
      {entry.label}
      {showCode && <span className="ltr opacity-60">{value}</span>}
    </Badge>
  );
}

export function CustomerStatusBadge({ value, showCode }: { value: CustomerStatus; showCode?: boolean }) {
  return <StatusBadge map={MAPS.customerStatus} value={value} showCode={showCode} />;
}
export function LicenseStatusBadge({ value, showCode }: { value: LicenseStatus; showCode?: boolean }) {
  return <StatusBadge map={MAPS.licenseStatus} value={value} showCode={showCode} />;
}
export function SubscriptionStatusBadge({ value, showCode }: { value: SubscriptionStatus; showCode?: boolean }) {
  return <StatusBadge map={MAPS.subscriptionStatus} value={value} showCode={showCode} />;
}
export function DeviceStatusBadge({ value, showCode }: { value: DeviceStatus; showCode?: boolean }) {
  return <StatusBadge map={MAPS.deviceStatus} value={value} showCode={showCode} />;
}
export function PaymentStatusBadge({ value, showCode }: { value: PaymentStatus; showCode?: boolean }) {
  return <StatusBadge map={MAPS.paymentStatus} value={value} showCode={showCode} />;
}
export function ValidationStatusBadge({ value, showCode }: { value: ValidationStatus; showCode?: boolean }) {
  return <StatusBadge map={MAPS.validationStatus} value={value} showCode={showCode} />;
}
export function BillingIntervalBadge({ value }: { value: BillingInterval }) {
  return <StatusBadge map={MAPS.billingInterval} value={value} />;
}
