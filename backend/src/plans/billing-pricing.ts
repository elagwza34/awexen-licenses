import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

export type SaleInterval = "MONTHLY" | "YEARLY";
export interface PaidPeriod {
  start: string;
  end: string;
  price: number;
  basisStart?: string;
  basisEnd?: string;
}
export function entitlementHash(plan: any) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        features: (plan.features ?? [])
          .map((p: any) => p.feature?.key ?? p.key)
          .sort(),
        limits: [
          plan.maxDevices,
          plan.maxUsers,
          plan.maxBranches,
          plan.maxWarehouses,
        ],
        enforced: plan.enforceEntitlements,
      }),
    )
    .digest("hex");
}
const fail = (message: string): never => {
  throw new BadRequestException(message);
};
export function money(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
    fail("Invalid monetary amount.");
  return value;
}
export function priceFor(plan: any, interval: string): number {
  const explicit =
    interval === "MONTHLY"
      ? plan.monthlyPrice
      : interval === "YEARLY"
        ? plan.yearlyPrice
        : undefined;
  const price =
    explicit ??
    ((plan.billingInterval ?? "MONTHLY") === interval ? plan.price : 0);
  money(price);
  if (!price) fail("The selected billing interval is not priced.");
  return price;
}
export function saleOptions(plan: any) {
  return (["MONTHLY", "YEARLY"] as const).flatMap((billingInterval) => {
    try {
      return [{ billingInterval, price: priceFor(plan, billingInterval) }];
    } catch {
      return [];
    }
  });
}
function calendarMonths(start: Date, months: number) {
  const date = new Date(start);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(
    Math.min(
      day,
      new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return date;
}
function next(start: Date, interval: string) {
  if (interval === "MONTHLY") return calendarMonths(start, 1);
  if (interval === "YEARLY") return calendarMonths(start, 12);
  return fail("This interval requires manual billing review.");
}
function previous(end: Date, interval: string) {
  if (interval === "MONTHLY") return calendarMonths(end, -1);
  if (interval === "YEARLY") return calendarMonths(end, -12);
  return fail("This interval requires manual billing review.");
}
function fraction(amount: number, numerator: number, denominator: number) {
  money(amount);
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator <= 0 ||
    numerator > denominator
  )
    fail("Invalid billing period.");
  return Number(
    (BigInt(amount) * BigInt(numerator) * 2n + BigInt(denominator)) /
      (BigInt(denominator) * 2n),
  );
}
function periodsFor(subscription: any, now: Date): PaidPeriod[] {
  const end = new Date(subscription.expiresAt);
  if (!subscription.expiresAt || !Number.isFinite(+end))
    fail("Lifetime or undated subscriptions require manual review.");
  if (Array.isArray(subscription.billingPeriods)) {
    if (subscription.billingPeriods.length > 120)
      fail("Too many prepaid periods; contact support.");
    const lastEnd = Math.max(
      ...subscription.billingPeriods.map((p: PaidPeriod) => +new Date(p.end)),
    );
    if (lastEnd !== +end)
      fail(
        "A manually changed expiry requires billing review before an automatic credit can be calculated.",
      );
    return subscription.billingPeriods.filter(
      (p: PaidPeriod) => +new Date(p.end) > +now,
    );
  }
  // Do not invent a price history for legacy multi-period prepayments.
  if (+end > +next(now, subscription.billingInterval))
    fail(
      "Legacy prepaid periods require an administrator review before upgrade.",
    );
  const initial = new Date(subscription.startsAt);
  const start =
    +next(initial, subscription.billingInterval) === +end
      ? initial
      : previous(end, subscription.billingInterval);
  return [
    {
      start: start.toISOString(),
      end: end.toISOString(),
      price: money(subscription.price),
    },
  ];
}

/** All amounts are minor units. Quote dates and prices are server-owned. */
export function billingQuote(
  plan: any,
  customer: any,
  subscription: any,
  interval: string,
  now = new Date(),
) {
  if (!["MONTHLY", "YEARLY"].includes(interval))
    fail("Choose monthly or yearly billing.");
  const price = priceFor(plan, interval);
  if (plan.status && plan.status !== "ACTIVE")
    fail("The selected plan is not available.");
  const quote: any = {
    version: 1,
    planId: plan.id,
    planVersion: plan.updatedAt?.toISOString?.() ?? null,
    entitlementHash: entitlementHash(plan),
    billingInterval: interval,
    currency: plan.currency,
    price,
    setupFee: 0,
    credit: 0,
    sourceSubscriptionId: subscription?.id ?? null,
    sourceVersion: subscription?.updatedAt?.toISOString?.() ?? null,
    sourceBillingVersion: subscription?.billingVersion ?? 0,
    kind: subscription ? "RENEWAL" : "PURCHASE",
    quotedAt: now.toISOString(),
  };
  let start = now;
  let end = next(now, interval);
  let serviceCharge = price;
  let periods: PaidPeriod[] = [];
  if (subscription) {
    if (subscription.customerId !== customer.id)
      fail("Subscription ownership mismatch.");
    if (!["ACTIVE", "TRIAL", "EXPIRED"].includes(subscription.status))
      fail("This subscription cannot be changed.");
    if (subscription.currency !== plan.currency)
      fail("Cross-currency changes require manual review.");
    const active =
      subscription.status === "ACTIVE" &&
      subscription.expiresAt &&
      +new Date(subscription.expiresAt) > +now;
    const same =
      subscription.planId === plan.id &&
      subscription.billingInterval === interval;
    if (active && same) {
      periods = periodsFor(subscription, now);
      start = new Date(subscription.expiresAt);
      end = next(start, interval);
    } else if (active) {
      quote.kind = "UPGRADE";
      const old = subscription.plan;
      if (old.enforceEntitlements === false)
        fail(
          "Legacy unrestricted subscriptions require an administrator review before changing their rights.",
        );
      const features = new Set(
        (plan.features ?? []).map((p: any) => p.feature?.key ?? p.key),
      );
      if (
        (old.features ?? []).some(
          (p: any) => !features.has(p.feature?.key ?? p.key),
        ) ||
        ["maxDevices", "maxUsers", "maxBranches", "maxWarehouses"].some(
          (key) => (plan[key] ?? 0) < (old[key] ?? 0),
        )
      )
        fail("A downgrade requires manual review.");
      periods = periodsFor(subscription, now);
      quote.credit = periods.reduce(
        (sum, p) =>
          sum +
          fraction(
            p.price,
            +new Date(p.end) - Math.max(+new Date(p.start), +now),
            +new Date(p.end) - +new Date(p.start),
          ),
        0,
      );
      if (subscription.billingInterval === interval) {
        if (price <= subscription.price && subscription.planId !== plan.id)
          fail("The target plan must have a higher price.");
        end = new Date(subscription.expiresAt);
        periods = periods.map((p) => {
          const effectiveStart = new Date(
            Math.max(+new Date(p.start), +now),
          ).toISOString();
          const basisStart = p.basisStart ?? p.start;
          const basisEnd = p.basisEnd ?? p.end;
          return {
            start: effectiveStart,
            end: p.end,
            price: fraction(
              price,
              +new Date(p.end) - +new Date(effectiveStart),
              +new Date(basisEnd) - +new Date(basisStart),
            ),
            basisStart,
            basisEnd,
          };
        });
        serviceCharge = periods.reduce((sum, p) => sum + p.price, 0);
      } else {
        periods = [];
      }
    }
  }
  if (!subscription && !customer.downloadEnabled)
    quote.setupFee = money(plan.setupFee ?? 0);
  if (!periods.length || quote.kind === "RENEWAL")
    periods.push({ start: start.toISOString(), end: end.toISOString(), price });
  quote.periodStart = start.toISOString();
  quote.periodEnd = end.toISOString();
  quote.serviceCharge = money(serviceCharge);
  quote.amount = serviceCharge + quote.setupFee - quote.credit;
  if (quote.amount <= 0)
    fail(
      "No positive payment is due; a credit or refund requires manual review.",
    );
  money(quote.amount);
  quote.periods = periods;
  return quote;
}
