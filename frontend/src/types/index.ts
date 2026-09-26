/** Mirrors the Prisma enums so the UI never guesses at a status. */
export type AdminRoleKey = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT_AGENT' | 'FINANCE' | 'VIEWER';
export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type PlanStatus = 'ACTIVE' | 'ARCHIVED';
export type FeatureStatus = 'ACTIVE' | 'DEPRECATED';
export type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'LIFETIME';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';
export type LicenseStatus = 'TRIAL' | 'EXPIRING' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';
export type DeviceStatus = 'ACTIVE' | 'BLOCKED' | 'REVOKED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
export type ValidationStatus =
  | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'SUSPENDED' | 'INVALID' | 'DEVICE_LIMIT' | 'REVOKED';

export interface AuthAdmin {
  id: number;
  email: string;
  name: string;
  status: string;
  locale: string;
  roles: AdminRoleKey[];
  permissions: string[];
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface Customer {
  id: number;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  taxNumber: string | null;
  notes: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerListItem extends Customer {
  _count: { licenses: number; subscriptions: number; tickets: number };
  licenses: Array<{ id: number; expiresAt: string | null; plan: { name: string; nameAr: string | null } }>;
}

export interface Feature {
  id: number;
  key: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  category: string;
  status: FeatureStatus;
  _count?: { plans: number };
}

export interface Plan {
  id: number;
  key: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  price: number;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  maxDevices: number;
  sortOrder: number;
  isPopular: boolean;
  isTrialPlan: boolean;
  status: PlanStatus;
  featureKeys?: string[];
  features?: Array<{ feature: Feature }>;
  _count?: { subscriptions: number; licenses: number };
}

export interface Device {
  id: number;
  licenseId: number;
  deviceFingerprint: string;
  deviceName: string | null;
  platform: string | null;
  osVersion: string | null;
  appVersion: string | null;
  status: DeviceStatus;
  activatedAt: string;
  lastSeenAt: string | null;
  lastValidationAt: string | null;
  lastIp: string | null;
  blockedReason: string | null;
}

export interface LicenseListItem {
  id: number;
  licenseKey: string;
  status: LicenseStatus;
  derivedStatus: LicenseStatus;
  startsAt: string;
  expiresAt: string | null;
  maxDevices: number;
  isTrial: boolean;
  version: number;
  daysRemaining: number | null;
  activeDevices: number;
  createdAt: string;
  customer: { id: number; name: string; company: string | null; email: string };
  plan: { id: number; name: string; nameAr: string | null; key: string };
  subscription: { id: number; status: SubscriptionStatus; expiresAt: string | null } | null;
}

export interface LicenseDetail extends LicenseListItem {
  customer: Customer;
  devices: Device[];
  features: string[];
  activeDevices: number;
  deviceSlotsFree: number;
  statusReason?: string;
  lastValidationAt: string | null;
  lastSeenAt: string | null;
  lastActivationAt: string | null;
  notes: string | null;
}

export interface DashboardOverview {
  customers: { total: number; active: number; trial: number };
  licenses: {
    active: number;
    expiring: number;
    expired: number;
    suspended: number;
    revoked: number;
  };
  devices: { active: number };
  payments: { pending: number; failed: number; todayRevenue: number; todayRevenueCount: number };
  revenue: { mrr: number; arr: number };
  currency: string;
}

export interface TimeSeriesPoint {
  month: string;
  revenue: number;
  newCustomers: number;
  newSubscriptions: number;
  activations: number;
  expirations: number;
}

export interface Setting {
  key: string;
  value: unknown;
  type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';
  label: string | null;
  labelAr: string | null;
  group: string;
  description: string | null;
  isSensitive: boolean;
  updatedAt: string;
}
