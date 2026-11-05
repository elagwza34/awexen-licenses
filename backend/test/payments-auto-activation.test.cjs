require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PaymentsService } = require('../src/payments/payments.service');

test('confirming an initial purchase issues its licence and preserves the payment response', async () => {
  const payment = { id: 7, subscriptionId: null, status: 'PENDING' };
  const service = new PaymentsService({ payment: { findUniqueOrThrow: async () => payment } }, {}, {});
  let approval;
  const actor = { id: 1 };
  const req = {};
  service.approveActivation = async (...args) => { approval = args; };
  service.findOne = async () => ({ ...payment, status: 'PAID' });
  const result = await service.verify(7, { notes: 'Bank transfer checked' }, actor, req);
  assert.deepEqual(approval, [7, { notes: 'Bank transfer checked' }, actor, req]);
  assert.equal(result.status, 'PAID');
});

test('retrying an already paid purchase still runs the idempotent licence approval', async () => {
  const payment = { id: 7, subscriptionId: null, status: 'PAID' };
  const service = new PaymentsService({ payment: { findUniqueOrThrow: async () => payment } }, {}, {});
  let called = false;
  service.approveActivation = async () => { called = true; };
  service.findOne = async () => payment;
  await service.verify(7, {}, {}, {});
  assert.equal(called, true);
});

test('a verified subscription payment keeps its existing conflict guard', async () => {
  const service = new PaymentsService({ payment: { findUniqueOrThrow: async () => ({ subscriptionId: 3, status: 'PAID' }) } }, {}, {});
  service.approveActivation = async () => assert.fail('must not issue another licence');
  await assert.rejects(service.verify(7, { renewSubscription: true }, {}, {}), /already verified/);
});

test('licence approval failures are returned instead of reporting payment-only success', async () => {
  const service = new PaymentsService({ payment: { findUniqueOrThrow: async () => ({ subscriptionId: null }) } }, {}, {});
  service.approveActivation = async () => { throw new Error('Ambiguous plan'); };
  await assert.rejects(service.verify(7, {}, {}, {}), /Ambiguous plan/);
});

test('approval reuses an active licence instead of minting another code', async () => {
  const payment = { id: 7, customerId: 4, subscriptionId: null, subscription: null, status: 'PAID', amount: 1000000 };
  const existing = { id: 3, customerId: 4, planId: 1, status: 'ACTIVE' };
  const prisma = {
    payment: { findUniqueOrThrow: async () => payment },
    plan: { findMany: async () => [{ id: 1 }] },
    license: { findFirst: async () => existing },
    $transaction: async (fn) => fn({ customer: { update: async () => ({}) } }),
  };
  const service = new PaymentsService(prisma, {}, { create: async () => assert.fail('duplicate licence') });
  const result = await service.approveActivation(7, {}, {}, {});
  assert.equal(result.license.id, 3);
});
