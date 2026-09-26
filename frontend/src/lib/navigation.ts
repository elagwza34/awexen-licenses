import {
  Activity,
  BarChart3,
  CalendarClock,
  CreditCard,
  FileClock,
  Gauge,
  KeyRound,
  Layers,
  LifeBuoy,
  Monitor,
  Rocket,
  Settings,
  Users,
} from 'lucide-react';
import type { AdminRoleKey } from '@/types';

export interface NavItem {
  label: string;
  labelEn: string;
  path: string;
  icon: React.ElementType;
  /** Required permission; omitted means visible to every signed-in admin. */
  permission?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'عام',
    items: [
      { label: 'لوحة التحكم', labelEn: 'Dashboard', path: '/', icon: Gauge },
      { label: 'العملاء', labelEn: 'Customers', path: '/customers', icon: Users, permission: 'customers.view' },
      { label: 'الاشتراكات', labelEn: 'Subscriptions', path: '/subscriptions', icon: CreditCard, permission: 'subscriptions.view' },
      { label: 'التراخيص', labelEn: 'Licenses', path: '/licenses', icon: KeyRound, permission: 'licenses.view' },
    ],
  },
  {
    title: 'التشغيل',
    items: [
      { label: 'الأجهزة', labelEn: 'Devices', path: '/devices', icon: Monitor, permission: 'devices.view' },
      { label: 'التفعيلات', labelEn: 'Activations', path: '/activations', icon: Activity, permission: 'activations.view' },
      { label: 'انتهاء الصلاحية', labelEn: 'Expirations', path: '/expirations', icon: CalendarClock, permission: 'licenses.view' },
      { label: 'الدعم الفني', labelEn: 'Support', path: '/support', icon: LifeBuoy, permission: 'support.view' },
    ],
  },
  {
    title: 'البيع',
    items: [
      { label: 'الخطط', labelEn: 'Plans', path: '/plans', icon: Layers, permission: 'plans.view' },
      { label: 'الميزات', labelEn: 'Features', path: '/features', icon: Layers, permission: 'features.view' },
      { label: 'المدفوعات', labelEn: 'Payments', path: '/payments', icon: CreditCard, permission: 'payments.view' },
    ],
  },
  {
    title: 'النظام',
    items: [
      { label: 'الإصدارات', labelEn: 'Releases', path: '/releases', icon: Rocket, permission: 'releases.view' },
      { label: 'التقارير', labelEn: 'Analytics', path: '/analytics', icon: BarChart3, permission: 'analytics.view' },
      { label: 'سجل التدقيق', labelEn: 'Audit Logs', path: '/audit-logs', icon: FileClock, permission: 'audit.view' },
      { label: 'الإعدادات', labelEn: 'Settings', path: '/settings', icon: Settings, permission: 'settings.view' },
    ],
  },
];

/** Roles are shown next to the admin name; the label is for the UI only. */
export const ROLE_LABELS: Record<AdminRoleKey, string> = {
  SUPER_ADMIN: 'المالك',
  ADMIN: 'مدير',
  SUPPORT_AGENT: 'موظف دعم',
  FINANCE: 'مالي',
  VIEWER: 'مطّلع',
};
