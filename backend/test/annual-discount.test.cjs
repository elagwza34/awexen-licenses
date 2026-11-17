require("ts-node/register/transpile-only");
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { priceFor, billingQuote } = require("../src/plans/billing-pricing");
test("annual service is twelve months less 15%, rounded once in minor units", () => {
  assert.equal(
    priceFor({ price: 350000, billingInterval: "MONTHLY" }, "YEARLY"),
    3570000,
  );
  assert.equal(
    priceFor({ monthlyPrice: 101, yearlyPrice: 9000 }, "YEARLY"),
    1030,
  );
  assert.equal(priceFor({ monthlyPrice: 105 }, "YEARLY"), 1071);
  assert.throws(() => priceFor({ monthlyPrice: 2147483647 }, "YEARLY"));
  assert.equal(
    priceFor({ price: 12000, billingInterval: "YEARLY" }, "YEARLY"),
    12000,
  );
});
test("first annual purchase separates the setup fee and never discounts it", () => {
  const q = billingQuote(
    {
      id: 1,
      price: 350000,
      billingInterval: "MONTHLY",
      setupFee: 500000,
      currency: "EGP",
    },
    { id: 1, downloadEnabled: false },
    null,
    "YEARLY",
    new Date("2026-11-17T00:00:00Z"),
  );
  assert.equal(q.serviceCharge, 3570000);
  assert.equal(q.setupFee, 500000);
  assert.equal(q.amount, 4070000);
  const renewalCustomer = billingQuote(
    {
      id: 1,
      price: 350000,
      billingInterval: "MONTHLY",
      setupFee: 500000,
      currency: "EGP",
    },
    { id: 1, downloadEnabled: true },
    null,
    "YEARLY",
    new Date("2026-11-17T00:00:00Z"),
  );
  assert.equal(renewalCustomer.setupFee, 0);
});
