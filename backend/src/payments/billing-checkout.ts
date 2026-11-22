import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { AuditEntity } from "@prisma/client";
import { billingQuote, entitlementHash } from "../plans/billing-pricing";
import { setupAlreadyPaid } from "./setup-fee-policy";
import type { CustomerMailService } from "../common/mail/customer-mail.service";

export async function createBillingQuote(
  prisma: any,
  customerId: number,
  input: { planId: number; billingInterval: string; subscriptionId?: number },
) {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
  });
  if (customer.deletedAt || customer.status !== "ACTIVE")
    throw new BadRequestException(
      "This customer cannot purchase a subscription.",
    );
  const plan = await prisma.plan.findUnique({
    where: { id: input.planId },
    include: { system: true, features: { include: { feature: true } } },
  });
  if (
    !plan ||
    plan.status !== "ACTIVE" ||
    !plan.enforceEntitlements ||
    plan.system?.active === false
  )
    throw new BadRequestException("The selected plan is not available.");
  const subscription = input.subscriptionId
    ? await prisma.subscription.findFirst({
        where: { id: input.subscriptionId, customerId },
        include: {
          plan: { include: { features: { include: { feature: true } } } },
        },
      })
    : null;
  if (input.subscriptionId && !subscription)
    throw new NotFoundException("Subscription not found.");
  if (
    subscription &&
    (subscription.plan.systemId ?? 1) !== (plan.systemId ?? 1)
  )
    throw new BadRequestException(
      "A subscription cannot change to a different software system.",
    );
  if (plan.systemId)
    customer.downloadEnabled = await setupAlreadyPaid(
      prisma,
      customer,
      plan.systemId,
    );
  const data = billingQuote(
    plan,
    customer,
    subscription,
    input.billingInterval,
  );
  const quote = await prisma.checkoutQuote.create({
    data: { customerId, data, expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  return { id: quote.id, expiresAt: quote.expiresAt, ...data };
}

export async function submitBillingQuote(
  prisma: any,
  customerId: number,
  input: any,
) {
  const { payment } = await submitBillingQuoteWithResult(prisma, customerId, input);
  return payment;
}

export async function submitBillingQuoteWithResult(
  prisma: any,
  customerId: number,
  input: any,
  mail?: CustomerMailService,
) {
  const quote = await prisma.checkoutQuote.findFirst({
    where: { id: input.quoteId, customerId },
  });
  if (!quote || +new Date(quote.expiresAt) <= Date.now())
    throw new ConflictException(
      "The quote expired. Refresh the price before submitting payment.",
    );
  const q = quote.data;
  if (q.planId !== input.planId || q.amount !== input.amount)
    throw new BadRequestException(
      "The price changed or the submitted amount does not match the quote.",
    );
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM checkout_quotes WHERE id=${quote.id}::uuid FOR UPDATE`;
    const existing = await tx.payment.findUnique({
      where: { checkoutQuoteId: quote.id },
    });
    if (existing) {
      if (["CANCELLED", "REFUNDED", "FAILED"].includes(existing.status))
        throw new ConflictException(
          "The previous request is closed. Refresh the quote.",
        );
      return { payment: existing, created: false, billingInterval: q.billingInterval };
    }
    if (+new Date(quote.expiresAt) <= Date.now())
      throw new ConflictException("The quote expired. Refresh it.");
    await tx.$queryRaw`SELECT id FROM plans WHERE id=${q.planId} FOR UPDATE`;
    const plan = await tx.plan.findUnique({
      where: { id: q.planId },
      include: { system: true, features: { include: { feature: true } } },
    });
    if (
      !plan ||
      plan.status !== "ACTIVE" ||
      plan.system?.active === false ||
      !plan.enforceEntitlements ||
      (plan.updatedAt?.toISOString?.() ?? null) !== q.planVersion ||
      entitlementHash(plan) !== q.entitlementHash
    )
      throw new ConflictException(
        "Plan changed. Refresh the quote before submitting payment.",
      );
    if (q.setupFee > 0 && plan.systemId) {
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: customerId },
      });
      if (await setupAlreadyPaid(tx, customer, plan.systemId))
        throw new ConflictException(
          "Setup was already paid. Refresh the quote without the one-time fee.",
        );
    }
    if (q.sourceSubscriptionId) {
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id=${q.sourceSubscriptionId} FOR UPDATE`;
      const source = await tx.subscription.findUnique({
        where: { id: q.sourceSubscriptionId },
      });
      if (
        !source ||
        source.customerId !== customerId ||
        source.updatedAt.toISOString() !== q.sourceVersion ||
        source.billingVersion !== q.sourceBillingVersion
      )
        throw new ConflictException(
          "Subscription changed. Refresh the quote before submitting payment.",
        );
    }
    const payment = await tx.payment.create({
      data: {
        customerId,
        planId: q.planId,
        subscriptionId: q.sourceSubscriptionId,
        checkoutQuoteId: quote.id,
        amount: q.amount,
        currency: q.currency,
        method: "BANK_TRANSFER",
        status: "PENDING",
        notes: input.notes?.trim() || null,
        receiptUrl: input.receipt?.url ?? null,
        transactionReference: `QUOTE-${quote.id}`,
      },
    });
    await mail?.payment(tx, payment, plan, q.billingInterval, false);
    return { payment, created: true, billingInterval: q.billingInterval };
  });
}

/** One locked transaction owns money acceptance, entitlement changes and signing. */
export async function approveBillingQuote(
  prisma: any,
  audit: any,
  licenses: any,
  id: number,
  dto: any,
  actor: any,
  req: any,
  mail?: CustomerMailService,
) {
  if (dto.issueLicense === false)
    throw new BadRequestException(
      "A quoted subscription payment must deliver its subscription and license together.",
    );
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id=${id} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id },
      include: { checkoutQuote: true },
    });
    if (!payment.checkoutQuote)
      throw new BadRequestException("No billing quote is attached.");
    if (payment.billingAppliedAt)
      return { payment, message: "تم تطبيق هذه الدفعة بالفعل." };
    if (
      !["PENDING", "PAID"].includes(payment.status) ||
      payment.refundedAmount > 0
    )
      throw new ConflictException("This payment cannot be applied.");
    const q = payment.checkoutQuote.data;
    if (
      payment.checkoutQuote.customerId !== payment.customerId ||
      q.planId !== payment.planId ||
      q.amount !== payment.amount ||
      q.currency !== payment.currency ||
      (dto.planId && dto.planId !== q.planId)
    )
      throw new ConflictException("Payment and quote do not match.");
    if (+new Date(q.periodEnd) <= Date.now())
      throw new ConflictException(
        "The quoted service period ended. Request a new quote; no license was changed.",
      );
    await tx.$queryRaw`SELECT id FROM customers WHERE id=${payment.customerId} FOR UPDATE`;
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: payment.customerId },
    });
    if (customer.deletedAt || customer.status !== "ACTIVE")
      throw new ConflictException("Customer is not active.");
    await tx.$queryRaw`SELECT id FROM plans WHERE id=${q.planId} FOR UPDATE`;
    const plan = await tx.plan.findUniqueOrThrow({
      where: { id: q.planId },
      include: { system: true, features: { include: { feature: true } } },
    });
    if (
      plan.status !== "ACTIVE" ||
      plan.system?.active === false ||
      !plan.enforceEntitlements ||
      plan.updatedAt.toISOString() !== q.planVersion ||
      entitlementHash(plan) !== q.entitlementHash
    )
      throw new ConflictException(
        "Plan changed after quotation. Review and requote this payment.",
      );
    if (
      q.setupFee > 0 &&
      plan.systemId &&
      (await setupAlreadyPaid(tx, customer, plan.systemId))
    )
      throw new ConflictException(
        "Setup was already paid. Review and requote without the one-time fee.",
      );
    if (dto.maxDevices !== undefined && dto.maxDevices !== plan.maxDevices)
      throw new ConflictException(
        "Quoted device limits cannot be overridden during approval.",
      );
    let subscriptionId = q.sourceSubscriptionId;
    if (subscriptionId) {
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id=${subscriptionId} FOR UPDATE`;
      const source = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      if (
        source.customerId !== payment.customerId ||
        source.updatedAt.toISOString() !== q.sourceVersion ||
        source.billingVersion !== q.sourceBillingVersion
      )
        throw new ConflictException(
          "Subscription changed. This stale quote cannot apply credit twice.",
        );
      const bound = await tx.license.findMany({
        where: { subscriptionId, status: { notIn: ["REVOKED", "SUSPENDED"] } },
        include: {
          _count: { select: { devices: { where: { status: "ACTIVE" } } } },
        },
      });
      if (bound.some((l: any) => l._count.devices > plan.maxDevices))
        throw new ConflictException(
          "Active devices exceed the target plan limit.",
        );
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          planId: q.planId,
          price: q.price,
          currency: q.currency,
          billingInterval: q.billingInterval,
          expiresAt: new Date(q.periodEnd),
          billingPeriods: q.periods,
          status: "ACTIVE",
          endedAt: null,
        },
      });
    } else {
      const created = await tx.subscription.create({
        data: {
          customerId: payment.customerId,
          planId: q.planId,
          status: "ACTIVE",
          price: q.price,
          currency: q.currency,
          billingInterval: q.billingInterval,
          startsAt: new Date(q.periodStart),
          expiresAt: new Date(q.periodEnd),
          billingPeriods: q.periods,
          autoRenew: false,
        },
      });
      subscriptionId = created.id;
    }
    const bound = await tx.license.findMany({
      where: { subscriptionId, status: { notIn: ["REVOKED", "SUSPENDED"] } },
    });
    if (!bound.length) {
      if (await tx.license.count({ where: { subscriptionId } }))
        throw new ConflictException(
          "Suspended or revoked licenses require a separate administrator review.",
        );
      await licenses.createForBilling(tx, {
        customerId: payment.customerId,
        subscriptionId,
        planId: q.planId,
        startsAt: new Date(q.periodStart),
        expiresAt: new Date(q.periodEnd),
        maxDevices: plan.maxDevices,
      });
    } else {
      for (const license of bound) {
        await tx.license.update({
          where: { id: license.id },
          data: {
            planId: q.planId,
            expiresAt: new Date(q.periodEnd),
            maxDevices: plan.maxDevices,
            status: "ACTIVE",
            isTrial: false,
            version: { increment: 1 },
          },
        });
        await licenses.signForBilling(tx, license.id);
      }
    }
    const now = new Date();
    const applied = await tx.payment.update({
      where: { id },
      data: {
        subscriptionId,
        status: "PAID",
        paidAt: payment.paidAt ?? now,
        verifiedAt: now,
        verifiedById: actor.id,
        billingAppliedAt: now,
        notes: dto.notes ?? payment.notes,
      },
    });
    await tx.customer.update({
      where: { id: payment.customerId },
      data: { downloadEnabled: true },
    });
    await audit.record(
      {
        action: "payment.billing_applied",
        entity: AuditEntity.PAYMENT,
        entityId: id,
        oldValue: { status: payment.status },
        newValue: { status: "PAID", subscriptionId, planId: q.planId },
        metadata: {
          kind: q.kind,
          billingInterval: q.billingInterval,
          amount: q.amount,
          unusedCredit: q.credit,
          periodEnd: q.periodEnd,
        },
        tx,
      },
      actor,
      req,
    );
    await mail?.payment(tx, applied, plan, q.billingInterval, true);
    return {
      payment: applied,
      message: "تم تأكيد الدفع وتحديث الاشتراك والترخيص.",
    };
  });
}
