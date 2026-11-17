type Interval = 'MONTHLY' | 'YEARLY';
interface CheckoutPlan {
  id: number;
  key: string;
  system: { key: string };
  billingOptions: { billingInterval: string; price: number }[];
}

export function parseBillingInterval(value: string | null): Interval | null {
  return value === null || value === 'MONTHLY' ? 'MONTHLY' : value === 'YEARLY' ? 'YEARLY' : null;
}

export function checkoutDestination(plan: CheckoutPlan | undefined, interval: Interval) {
  if (!plan) return '/portal/subscription';
  const query = new URLSearchParams({ plan: plan.key, billingInterval: interval });
  return '/portal/subscription/' + encodeURIComponent(plan.system.key) + '?' + query;
}

/** Explicit selection wins over stored preferences, but never over catalogue availability. */
export function resolveCheckoutSelection(plans: CheckoutPlan[], systemKey: string | undefined, parameters: URLSearchParams, requestedPlanId?: number | null) {
  const interval = parseBillingInterval(parameters.get('billingInterval'));
  const key = parameters.get('plan');
  const eligible = plans.filter(plan => plan.system.key === systemKey);
  const selected = key ? eligible.find(plan => plan.key === key) : eligible.find(plan => plan.id === requestedPlanId);
  if (!interval || (key && !selected) || (selected && !selected.billingOptions.some(option => option.billingInterval === interval))) {
    return { planId: null, interval: interval ?? 'MONTHLY', error: 'الخطة أو مدة الاشتراك المختارة غير متاحة. اختر من الباقات الحالية.' } as const;
  }
  return { planId: selected?.id ?? null, interval };
}
