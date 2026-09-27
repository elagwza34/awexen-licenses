import {
  CreditCard,
  Gauge,
  KeyRound,
  Layers,
  ReceiptText,
  UserCog,
} from 'lucide-react';

export interface PortalNavItem {
  label: string;
  labelEn: string;
  path: string;
  icon: React.ElementType;
  description: string;
}

/**
 * The customer's own screens.
 *
 * No permission filter here: every item is scoped by the customer's token on
 * the server, so a customer simply cannot reach another customer's data. Hiding
 * a link they are entitled to would be worse than showing it and having the API
 * refuse.
 */
export const PORTAL_NAV: PortalNavItem[] = [
  {
    label: 'الرئيسية',
    labelEn: 'Overview',
    path: '/portal',
    icon: Gauge,
    description: 'نظرة سريعة على ترخيصك وأكواد التفعيل',
  },
  {
    label: 'أكواد التفعيل',
    labelEn: 'Licences',
    path: '/portal/licenses',
    icon: KeyRound,
    description: 'أكواد التفعيل والأجهزة المرتبطة بها',
  },
  {
    label: 'الاشتراك',
    labelEn: 'Subscription',
    path: '/portal/subscription',
    icon: CreditCard,
    description: 'باقتك وتاريخ التجديد',
  },
  {
    label: 'طلبات التفعيل',
    labelEn: 'Requests',
    path: '/portal/requests',
    icon: ReceiptText,
    description: 'طلباتك وحالة مراجعتها',
  },
  {
    label: 'تنزيل البرنامج',
    labelEn: 'Download',
    path: '/portal/download',
    icon: Layers,
    description: 'أحدث إصدار متاح لجهازك',
  },
  {
    label: 'حسابي',
    labelEn: 'Account',
    path: '/portal/account',
    icon: UserCog,
    description: 'بياناتك الشخصية',
  },
];
