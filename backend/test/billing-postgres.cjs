require("ts-node/register/transpile-only");
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const { generateKeyPairSync } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { ConfigService } = require("@nestjs/config");
const { AuditService } = require("../src/common/audit/audit.service");
const { CustomerMailService } = require("../src/common/mail/customer-mail.service");
const { RegistrationVerificationService } = require("../src/customer-portal/registration-verification.service");
const {
  LicenseCryptoService,
} = require("../src/common/crypto/license-crypto.service");
const { LicensesService } = require("../src/licenses/licenses.service");
const { PaymentsService } = require("../src/payments/payments.service");
const {
  CustomerPortalService,
} = require("../src/customer-portal/customer-portal.service");
const {
  createBillingQuote,
  submitBillingQuote,
  submitBillingQuoteWithResult,
  approveBillingQuote,
} = require("../src/payments/billing-checkout");

test("isolated billing: paid purchase, concurrent approvals, renewals, proration, stale quotes and rollback", async () => {
  const url = new URL(process.env.PMS_LMS_TEST_URL || "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "pms_remediation_test_admin");
  assert.notEqual(url.port, "5432");
  assert.match(url.pathname, /^\/pms_lms_test_[0-9a-f]{32}$/);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const actual = await db.$queryRawUnsafe("SHOW data_directory");
    assert.equal(
      path.resolve(actual[0].data_directory).toLowerCase(),
      path.resolve(process.env.PMS_TEST_DATA_DIRECTORY).toLowerCase(),
    );
    const admin = await db.admin.create({
      data: {
        name: "Fixture admin",
        email: "billing-admin@example.invalid",
        passwordHash: "fixture-not-a-real-login",
      },
    });
    const actor = { id: admin.id, email: admin.email },
      req = { headers: {}, ip: "127.0.0.1" };
    const customer = await db.customer.create({
      data: {
        name: "Synthetic buyer",
        email: "billing-buyer@example.invalid",
        passwordHash: "fixture",
      },
    });
    const other = await db.customer.create({
      data: {
        name: "Other fixture",
        email: "other@example.invalid",
        passwordHash: "fixture",
      },
    });
    const pos = await db.feature.create({
      data: { key: "FIXTURE_POS", name: "Fixture POS" },
    });
    const extra = await db.feature.create({
      data: { key: "FIXTURE_IMPORT", name: "Fixture import" },
    });
    const basic = await db.plan.create({
      data: {
        key: "FIXTURE_BASIC",
        name: "Basic",
        price: 30000,
        monthlyPrice: 30000,
        yearlyPrice: 300000,
        setupFee: 10000,
        enforceEntitlements: true,
        features: { create: [{ featureId: pos.id }] },
      },
    });
    const pro = await db.plan.create({
      data: {
        key: "FIXTURE_PRO",
        name: "Pro",
        price: 60000,
        monthlyPrice: 60000,
        yearlyPrice: 600000,
        maxDevices: 3,
        enforceEntitlements: true,
        features: { create: [{ featureId: pos.id }, { featureId: extra.id }] },
      },
    });
    const dual = await db.plan.create({
      data: {
        key: "FIXTURE_EXPLICIT",
        name: "Explicit prices",
        price: 0,
        monthlyPrice: 12000,
        yearlyPrice: 120000,
        enforceEntitlements: true,
        features: { create: [{ featureId: pos.id }] },
      },
    });
    const mailConfig = new ConfigService({ JWT_ACCESS_SECRET: "fixture-secret" });
    const mail = new CustomerMailService(mailConfig, db);
    const delivered = [];
    mail.send = async (email, subject, body) => delivered.push({ email, subject, body });
    const verification = new RegistrationVerificationService(db, mailConfig, mail);
    const portal = new CustomerPortalService(
      db,
      { hashPassword: async () => "fixture-hash" },
      { signAsync: async () => "fixture-session" },
      new ConfigService({}),
      verification,
      mail,
    );
    const registrationEmail = "explicit-prices@example.invalid";
    await verification.request(registrationEmail);
    assert.equal(await db.customer.count({ where: { email: registrationEmail } }), 0);
    const verificationCode = delivered[0].body.match(/\d{6}/)[0];
    await portal.register(
      {
        email: registrationEmail,
        name: "Explicit fixture",
        password: "Fixture-Password-42!",
        planKey: dual.key,
        verificationCode,
      },
      req,
    );
    assert.equal(
      (
        await db.customer.findUniqueOrThrow({
          where: { email: "explicit-prices@example.invalid" },
        })
      ).requestedPlanId,
      dual.id,
    );
    const config = new ConfigService({ LICENSE_KEY_PREFIX: "FIXTURE" }),
      signer = new LicenseCryptoService(config);
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    // Ephemeral keys stay in memory; production key paths are never read or written.
    signer.privateKeyPem = keys.privateKey.export({
      type: "pkcs8",
      format: "pem",
    });
    signer.publicKeyPem = keys.publicKey.export({
      type: "spki",
      format: "pem",
    });
    const audit = new AuditService(db),
      licenses = new LicensesService(db, audit, signer, {}, config, {});
    const quote = await createBillingQuote(db, customer.id, {
      planId: basic.id,
      billingInterval: "MONTHLY",
    });
    assert.equal(quote.amount, 40000);
    await assert.rejects(
      submitBillingQuote(db, other.id, {
        quoteId: quote.id,
        planId: basic.id,
        amount: quote.amount,
      }),
      /expired/,
    );
    await assert.rejects(
      submitBillingQuote(db, customer.id, {
        quoteId: quote.id,
        planId: basic.id,
        amount: 1,
      }),
      /amount/,
    );
    const submit = () =>
      submitBillingQuoteWithResult(db, customer.id, {
        quoteId: quote.id,
        planId: basic.id,
        amount: quote.amount,
        receipt: { url: "/fixture/receipt" },
      }, mail);
    const payments = (await Promise.all([submit(), submit()])).map(result => result.payment);
    assert.equal(payments[0].id, payments[1].id);
    assert.equal(await db.payment.count(), 1);
    assert.equal(await db.license.count(), 0);
    await Promise.all([
      approveBillingQuote(db, audit, licenses, payments[0].id, {}, actor, req, mail),
      approveBillingQuote(db, audit, licenses, payments[0].id, {}, actor, req, mail),
    ]);
    const notifications = await db.customerEmail.findMany({ orderBy: { id: 'asc' } });
    assert.deepEqual(notifications.slice(0, 2).map(message => message.id), [`approved:${payments[0].id}`, `pending:${payments[0].id}`]);
    assert.equal(notifications.length, 3);
    assert.match(notifications[2].id, /^welcome:/);
    assert.equal(notifications[2].email, registrationEmail);
    assert.equal(notifications[0].email, customer.email);
    assert.ok(notifications[0].body.includes('/portal/download?planKey=' + encodeURIComponent(basic.key)));
    assert.ok(notifications[1].body.includes('400.00'));
    await mail.deliver();
    await mail.deliver();
    assert.equal(delivered.length, 4);
    assert.equal(await db.customerEmail.count({ where: { sentAt: null } }), 0);
    assert.equal(await db.subscription.count(), 1);
    assert.equal(await db.license.count(), 1);
    let license = await db.license.findFirstOrThrow(),
      sub = await db.subscription.findFirstOrThrow();
    const key = license.licenseKey;
    assert.match(key, /^FIXTURE-/);
    assert.equal(license.version, 1);
    const signed = await licenses.getSignedPayload(license.id);
    assert.equal(
      signer.verify(signer.canonicalize(signed.payload), license.signature),
      true,
    );
    async function request(planId, interval) {
      const q = await createBillingQuote(db, customer.id, {
        planId,
        billingInterval: interval,
        subscriptionId: sub.id,
      });
      const p = await submitBillingQuote(db, customer.id, {
        quoteId: q.id,
        planId,
        amount: q.amount,
      });
      return { q, p };
    }
    const renewal = await request(basic.id, "MONTHLY");
    assert.equal(renewal.q.setupFee, 0);
    await approveBillingQuote(
      db,
      audit,
      licenses,
      renewal.p.id,
      {},
      actor,
      req,
    );
    sub = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    assert.equal(sub.billingPeriods.length, 2);
    const first = await request(pro.id, "MONTHLY"),
      second = await request(pro.id, "MONTHLY");
    assert.ok(first.q.credit > 30000);
    assert.equal(first.q.periodEnd, sub.expiresAt.toISOString());
    await approveBillingQuote(db, audit, licenses, first.p.id, {}, actor, req);
    await assert.rejects(
      approveBillingQuote(db, audit, licenses, second.p.id, {}, actor, req),
      /stale/,
    );
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { id: second.p.id } }))
        .status,
      "PENDING",
    );
    license = await db.license.findFirstOrThrow();
    assert.equal(license.licenseKey, key);
    assert.equal(license.planId, pro.id);
    assert.equal(await db.license.count(), 1);
    const annual = await request(pro.id, "YEARLY");
    assert.ok(annual.q.credit > 0);
    assert.equal(annual.q.price, 612000);
    await approveBillingQuote(db, audit, licenses, annual.p.id, {}, actor, req);
    sub = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    assert.equal(sub.billingInterval, "YEARLY");
    const rollback = await request(pro.id, "YEARLY"),
      before = sub.expiresAt.toISOString();
    const sign = licenses.signForBilling.bind(licenses);
    licenses.signForBilling = async () => {
      throw new Error("fixture signing failure");
    };
    await assert.rejects(
      approveBillingQuote(db, audit, licenses, rollback.p.id, {}, actor, req),
      /signing failure/,
    );
    licenses.signForBilling = sign;
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { id: rollback.p.id } }))
        .status,
      "PENDING",
    );
    assert.equal(
      (
        await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })
      ).expiresAt.toISOString(),
      before,
    );
    const revision = await createBillingQuote(db, customer.id, {
      planId: pro.id,
      billingInterval: "YEARLY",
      subscriptionId: sub.id,
    });
    await db.$executeRaw`UPDATE subscriptions SET updated_at=updated_at WHERE id=${sub.id}`;
    await assert.rejects(
      submitBillingQuote(db, customer.id, {
        quoteId: revision.id,
        planId: pro.id,
        amount: revision.amount,
      }),
      /Subscription changed/,
    );
    const changed = await request(pro.id, "YEARLY");
    const changedBeforeSubmission = await createBillingQuote(db, customer.id, {
      planId: pro.id,
      billingInterval: "YEARLY",
      subscriptionId: sub.id,
    });
    await db.planFeature.deleteMany({
      where: { planId: pro.id, featureId: extra.id },
    });
    await assert.rejects(
      submitBillingQuote(db, customer.id, {
        quoteId: changedBeforeSubmission.id,
        planId: pro.id,
        amount: changedBeforeSubmission.amount,
      }),
      /Plan changed/,
    );
    await assert.rejects(
      approveBillingQuote(db, audit, licenses, changed.p.id, {}, actor, req),
      /Plan changed/,
    );
    assert.equal(await db.license.count(), 1);
    const paymentService = new PaymentsService(db, audit, licenses);
    const race = await request(pro.id, "YEARLY");
    const outcomes = await Promise.allSettled([
      approveBillingQuote(db, audit, licenses, race.p.id, {}, actor, req),
      paymentService.reject(
        race.p.id,
        { reason: "Fixture rejection" },
        actor,
        req,
      ),
    ]);
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    const raced = await db.payment.findUniqueOrThrow({
      where: { id: race.p.id },
    });
    assert.equal(raced.status, raced.billingAppliedAt ? "PAID" : "CANCELLED");
    await assert.rejects(
      paymentService.refund(
        payments[0].id,
        { amount: 1, reason: "Fixture" },
        actor,
        req,
      ),
      /reviewed billing reversal/,
    );
    await db.license.update({
      where: { id: license.id },
      data: { status: "SUSPENDED" },
    });
    const blocked = await request(pro.id, "YEARLY");
    const expiry = (
      await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })
    ).expiresAt.toISOString();
    await assert.rejects(
      approveBillingQuote(db, audit, licenses, blocked.p.id, {}, actor, req),
      /Suspended or revoked/,
    );
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { id: blocked.p.id } }))
        .status,
      "PENDING",
    );
    assert.equal(
      (
        await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })
      ).expiresAt.toISOString(),
      expiry,
    );
    assert.equal(await db.license.count(), 1);
    console.log(
      "Verified ownership, amount tampering, submit/approval races, key reuse, multi-period credit, annual switch, stale-quote rejection, signing rollback and entitlement-change rejection.",
    );
  } finally {
    await db.$disconnect();
  }
});
