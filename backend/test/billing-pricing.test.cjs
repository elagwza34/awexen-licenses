require("ts-node/register/transpile-only");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { billingQuote, priceFor } = require("../src/plans/billing-pricing");
const now = new Date("2026-11-16T00:00:00Z");
const basic = {
  id: 1,
  key: "BASIC",
  price: 30000,
  billingInterval: "MONTHLY",
  currency: "EGP",
  maxDevices: 1,
  maxUsers: 2,
  maxBranches: 1,
  maxWarehouses: 1,
  features: [{ feature: { key: "POS" } }],
  updatedAt: new Date("2026-11-01"),
};
const pro = {
  ...basic,
  id: 2,
  key: "PRO",
  price: 60000,
  monthlyPrice: 60000,
  yearlyPrice: 600000,
  maxDevices: 3,
  features: [...basic.features, { feature: { key: "IMPORT" } }],
};
const customer = { id: 9, downloadEnabled: true };
const subscription = {
  id: 4,
  customerId: 9,
  planId: 1,
  plan: basic,
  status: "ACTIVE",
  price: 30000,
  currency: "EGP",
  billingInterval: "MONTHLY",
  startsAt: new Date("2026-11-01"),
  currentPeriodStart: new Date("2026-11-01"),
  expiresAt: new Date("2026-12-01"),
  updatedAt: new Date("2026-11-01"),
};
test("annual price follows the approved 15 percent discount on monthly service", () => {
  assert.equal(priceFor(basic, "MONTHLY"), 30000);
  assert.equal(priceFor(basic, "YEARLY"),306000);
  assert.equal(priceFor({ ...pro, yearlyPrice: 0 }, "YEARLY"),612000);
});
test("same-interval upgrade charges the remaining difference and preserves expiry", () => {
  const q = billingQuote(pro, customer, subscription, "MONTHLY", now);
  assert.equal(q.credit, 15000);
  assert.equal(q.serviceCharge, 30000);
  assert.equal(q.amount, 15000);
  assert.equal(q.periodEnd, subscription.expiresAt.toISOString());
});
test("switching to annual starts an annual term and credits unused monthly service", () => {
  const q = billingQuote(pro, customer, subscription, "YEARLY", now);
  assert.equal(q.amount, 597000);
  assert.equal(q.periodEnd, "2027-11-16T00:00:00.000Z");
});
test("renewal extends from current expiry without charging setup twice", () => {
  const q = billingQuote(basic, customer, subscription, "MONTHLY", now);
  assert.equal(q.credit, 0);
  assert.equal(q.periodStart, "2026-12-01T00:00:00.000Z");
  assert.equal(q.periodEnd, "2027-01-01T00:00:00.000Z");
});
test("first purchase includes setup once and respects February calendar boundaries", () => {
  const q = billingQuote(
    { ...pro, setupFee: 10000 },
    { id: 9, downloadEnabled: false },
    null,
    "MONTHLY",
    new Date("2027-01-31T00:00:00Z"),
  );
  assert.equal(q.amount, 70000);
  assert.equal(q.periodEnd, "2027-02-28T00:00:00.000Z");
});
test("cross-currency, downgrades and negative balances require manual review", () => {
  assert.throws(() =>
    billingQuote(
      { ...pro, currency: "USD" },
      customer,
      subscription,
      "MONTHLY",
      now,
    ),
  );
  assert.throws(() =>
    billingQuote(
      { ...pro, features: [] },
      customer,
      subscription,
      "MONTHLY",
      now,
    ),
  );
  assert.throws(() =>
    billingQuote(
      { ...pro, monthlyPrice:10, yearlyPrice: 100 },
      customer,
      subscription,
      "YEARLY",
      now,
    ),
  );
});
test("prepaid periods are credited independently and upgrades retain every paid expiry", () => {
  const sub = {
    ...subscription,
    expiresAt: new Date("2027-01-01"),
    billingPeriods: [
      {
        start: "2026-11-01T00:00:00Z",
        end: "2026-12-01T00:00:00Z",
        price: 30000,
      },
      {
        start: "2026-12-01T00:00:00Z",
        end: "2027-01-01T00:00:00Z",
        price: 30000,
      },
    ],
  };
  const q = billingQuote(pro, customer, sub, "MONTHLY", now);
  assert.equal(q.credit, 45000);
  assert.equal(q.serviceCharge, 90000);
  assert.equal(q.amount, 45000);
  assert.equal(q.periodEnd, "2027-01-01T00:00:00.000Z");
});
test("calendar billing is UTC-stable across daylight-saving and leap days", () => {
  const q = billingQuote(
    pro,
    customer,
    null,
    "MONTHLY",
    new Date("2027-03-31T00:00:00Z"),
  );
  assert.equal(q.periodEnd, "2027-04-30T00:00:00.000Z");
  const year = billingQuote(
    pro,
    customer,
    null,
    "YEARLY",
    new Date("2028-02-29T12:00:00Z"),
  );
  assert.equal(year.periodEnd, "2029-02-28T12:00:00.000Z");
});
test("manual expiry changes and legacy unrestricted rights cannot silently become prorated credit", () => {
  assert.throws(() =>
    billingQuote(
      pro,
      customer,
      { ...subscription, plan: { ...basic, enforceEntitlements: false } },
      "MONTHLY",
      now,
    ),
  );
  assert.throws(() =>
    billingQuote(
      pro,
      customer,
      {
        ...subscription,
        billingPeriods: [
          { start: "2026-11-01", end: "2026-11-30", price: 30000 },
        ],
      },
      "MONTHLY",
      now,
    ),
  );
});
test("trial time has no cash credit and a paid interval starts afresh", () => {
  const q = billingQuote(
    pro,
    customer,
    { ...subscription, status: "TRIAL", price: 0 },
    "MONTHLY",
    now,
  );
  assert.equal(q.credit, 0);
  assert.equal(q.amount, 60000);
  assert.equal(q.periodEnd, "2026-12-16T00:00:00.000Z");
});
