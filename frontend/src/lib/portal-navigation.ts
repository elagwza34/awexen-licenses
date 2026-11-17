import {
  CreditCard,
  Gauge,
  KeyRound,
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
    label: 'اشتراكاتي',
    labelEn: 'My subscriptions',
    path: '/portal/my-subscriptions',
    icon: KeyRound,
    description: 'تفاصيل الاشتراكات وأكواد التفعيل والتنزيل',
  },
  {
    label: 'الأنظمة والاشتراكات',
    labelEn: 'Systems and subscriptions',
    path: '/portal/subscription',
    icon: CreditCard,
    description: 'اختر النظام والخطة ومدة الاشتراك',
  },
  {
    label: 'طلبات التفعيل',
    labelEn: 'Requests',
    path: '/portal/requests',
    icon: ReceiptText,
    description: 'طلباتك وحالة مراجعتها',
  },
  {
    label: 'حسابي',
    labelEn: 'Account',
    path: '/portal/account',
    icon: UserCog,
    description: 'بياناتك الشخصية',
  },
];
