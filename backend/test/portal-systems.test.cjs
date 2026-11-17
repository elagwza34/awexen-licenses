require("ts-node/register/transpile-only");
const { entitlementHash } = require("../src/plans/billing-pricing");
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  CustomerPortalService,
} = require("../src/customer-portal/customer-portal.service");
test("legacy PMS quote hashes remain compatible while new systems are bound to their identity", () => {
  const plan = {
    features: [],
    enforceEntitlements: true,
    maxDevices: 1,
    maxUsers: 2,
    maxBranches: 1,
    maxWarehouses: 1,
  };
  assert.equal(
    entitlementHash(plan),
    entitlementHash({ ...plan, systemId: 1 }),
  );
  assert.notEqual(
    entitlementHash(plan),
    entitlementHash({ ...plan, systemId: 2 }),
  );
});
test("portal systems expose only active systems and subscriptions remain owner scoped", async () => {
  let systemsQuery, subscriptionQuery;
  const db = {
    softwareSystem: { findMany: async (q) => ((systemsQuery = q), []) },
    license: { count: async () => 0 },
    subscription: { findMany: async (q) => ((subscriptionQuery = q), []) },
  };
  const portal = new CustomerPortalService(db, {}, {}, {});
  await portal.systems();
  await portal.billingSubscriptions(17);
  assert.equal(systemsQuery.where.active, true);
  assert.equal(subscriptionQuery.where.customerId, 17);
  assert.ok(subscriptionQuery.select.plan.select.system);
  assert.ok(subscriptionQuery.select.licenses);
});
test("new systems cannot borrow the global PMS installer channel", async () => {
  const { latestEligibleRelease } = require("../src/releases/release-policy");
  let channels;
  const db = {
    plan: { findMany: async () => [{ id: 2, systemId: 2 }] },
    appVersion: {
      findMany: async (q) => ((channels = q.where.channel.in), []),
    },
  };
  await latestEligibleRelease(db, [2]);
  assert.deepEqual(channels, ["stable-plan-2"]);
});
