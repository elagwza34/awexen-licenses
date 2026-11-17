require("ts-node/register/transpile-only");
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const {
  CustomerPortalService,
} = require("../src/customer-portal/customer-portal.service");
const {
  createBillingQuote,
  submitBillingQuote,
  approveBillingQuote,
} = require("../src/payments/billing-checkout");
const { latestEligibleRelease } = require("../src/releases/release-policy");
test("isolated systems: owned subscriptions, automatic annual prices, setup per system and scoped releases", async () => {
  const url = new URL(process.env.PMS_LMS_TEST_URL || "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "pms_remediation_test_admin");
  assert.match(url.pathname, /^\/pms_lms_test_[a-f0-9]{32}$/);
  assert.notEqual(url.port, "5432");
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const actual = await db.$queryRawUnsafe("SHOW data_directory");
    assert.equal(
      path.resolve(actual[0].data_directory).toLowerCase(),
      path.resolve(process.env.PMS_TEST_DATA_DIRECTORY).toLowerCase(),
    );
    const portal = new CustomerPortalService(db, {}, {}, {});
    const initial = await portal.systems();
    assert.equal(initial.data.length, 1);
    assert.equal(initial.data[0].key, "PMS");
    const other = await db.softwareSystem.create({
      data: {
        key: "SECOND_FIXTURE",
        name: "Synthetic second system",
        nameAr: "Synthetic second system",
      },
    });
    const p = await db.plan.create({
      data: {
        key: "SECOND_FIXTURE_PLAN",
        name: "Synthetic plan",
        systemId: other.id,
        price: 350000,
        billingInterval: "MONTHLY",
        setupFee: 500000,
        enforceEntitlements: true,
      },
    });
    const owner = await db.customer.create({
      data: {
        name: "Synthetic system owner",
        email: "systems@example.invalid",
        downloadEnabled: true,
      },
    });
    const different = await db.customer.create({
      data: {
        name: "Synthetic other owner",
        email: "other-systems@example.invalid",
      },
    });
    const sub = await db.subscription.create({
      data: {
        customerId: owner.id,
        planId: p.id,
        price: 350000,
        currency: "EGP",
        billingInterval: "MONTHLY",
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await db.license.create({
      data: {
        customerId: owner.id,
        planId: p.id,
        subscriptionId: sub.id,
        licenseKey: "SYNTHETIC-SYSTEM-OWNER-12345678",
        startsAt: new Date(),
        status: "ACTIVE",
        signature: "synthetic-not-valid",
      },
    });
    const owned = await portal.billingSubscriptions(owner.id);
    assert.equal(owned.subscriptions.length, 1);
    assert.equal(owned.subscriptions[0].plan.system.key, other.key);
    assert.notEqual(
      owned.subscriptions[0].licenses[0].licenseKey,
      "SYNTHETIC-SYSTEM-OWNER-12345678",
    );
    assert.equal(
      (await portal.billingSubscriptions(different.id)).subscriptions.length,
      0,
    );
    const quote = await createBillingQuote(db, different.id, {
      planId: p.id,
      billingInterval: "YEARLY",
    });
    assert.equal(quote.serviceCharge, 3570000);
    assert.equal(quote.setupFee, 500000);
    assert.equal(quote.amount, 4070000);
    await assert.rejects(
      createBillingQuote(db, different.id, {
        planId: p.id,
        billingInterval: "YEARLY",
        subscriptionId: sub.id,
      }),
      /not found/,
    );
    const fresh = await db.customer.create({
      data: {
        name: "Synthetic paid elsewhere",
        email: "paid-elsewhere@example.invalid",
        downloadEnabled: true,
      },
    });
    const freshQuote = await createBillingQuote(db, fresh.id, {
      planId: p.id,
      billingInterval: "YEARLY",
    });
    assert.equal(freshQuote.setupFee, 500000);
    const pending = await submitBillingQuote(db, fresh.id, {
      quoteId: freshQuote.id,
      planId: p.id,
      amount: freshQuote.amount,
    });
    await db.license.create({
      data: {
        customerId: fresh.id,
        planId: p.id,
        licenseKey: "SYNTHETIC-ALREADY-SETUP-12345678",
        startsAt: new Date(),
      },
    });
    await assert.rejects(
      approveBillingQuote(db, {}, {}, pending.id, {}, {}, {}),
      /Setup was already paid/,
    );
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { id: pending.id } }))
        .status,
      "PENDING",
    );
    await db.license.create({
      data: {
        customerId: different.id,
        planId: p.id,
        licenseKey: "SYNTHETIC-SECOND-SETUP-12345678",
        startsAt: new Date(),
      },
    });
    await assert.rejects(
      submitBillingQuote(db, different.id, {
        quoteId: quote.id,
        planId: p.id,
        amount: quote.amount,
      }),
      /Setup was already paid/,
    );
    const withoutSetup = await createBillingQuote(db, different.id, {
      planId: p.id,
      billingInterval: "YEARLY",
    });
    assert.equal(withoutSetup.setupFee, 0);
    assert.equal(withoutSetup.amount, 3570000);
    const catalogue = await portal.catalogue();
    assert.equal(
      catalogue.plans
        .find((x) => x.id === p.id)
        .billingOptions.find((x) => x.billingInterval === "YEARLY").price,
      3570000,
    );
    assert.equal(await latestEligibleRelease(db, [p.id]), null);
    const pmsPlan = await db.plan.findFirstOrThrow({ where: { systemId: 1 } });
    const firstPms = await createBillingQuote(db, owner.id, {
      planId: pmsPlan.id,
      billingInterval: "MONTHLY",
    });
    assert.equal(firstPms.setupFee, pmsPlan.setupFee);
    await assert.rejects(
      createBillingQuote(db, owner.id, {
        planId: pmsPlan.id,
        billingInterval: "MONTHLY",
        subscriptionId: sub.id,
      }),
      /different software system/,
    );
    await db.softwareSystem.update({
      where: { id: other.id },
      data: { active: false },
    });
    assert.equal(
      (await portal.systems()).data.some((x) => x.id === other.id),
      false,
    );
    assert.equal(
      (await portal.catalogue()).plans.some((x) => x.id === p.id),
      false,
    );
    await assert.rejects(
      createBillingQuote(db, fresh.id, {
        planId: p.id,
        billingInterval: "YEARLY",
      }),
      /not available/,
    );
  } finally {
    await db.$disconnect();
  }
});
