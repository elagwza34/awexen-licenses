require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RegistrationVerificationService } = require('../src/customer-portal/registration-verification.service');

test('registration code is bound to the email and the signing secret', () => {
  const make = secret => new RegistrationVerificationService({}, { getOrThrow: () => secret }, {});
  const service = make('test-secret');
  const digest = service.digest('buyer@example.com', '012345');
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, service.digest('different@example.com', '012345'));
  assert.notEqual(digest, service.digest('buyer@example.com', '012346'));
  assert.notEqual(digest, make('another-secret').digest('buyer@example.com', '012345'));
});

test('wrong codes consume attempts, and successful registration consumes the code', async () => {
  const email = 'buyer@example.com';
  let entry;
  let created = 0;
  const tx = {
    $queryRaw: async () => [],
    registrationVerification: {
      findUnique: async () => entry,
      update: async () => { entry.attempts++; },
      delete: async () => { entry = undefined; },
    },
  };
  const service = new RegistrationVerificationService({ $transaction: run => run(tx) }, { getOrThrow: () => 'test-secret' }, {});
  const create = async () => ++created;
  entry = { digest: service.digest(email, '012345'), attempts: 0, expiresAt: new Date(Date.now() + 10000) };
  await assert.rejects(service.complete(email, '000000', create), { status: 400 });
  assert.equal(entry.attempts, 1);
  assert.equal(created, 0);
  assert.equal(await service.complete(email, '012345', create), 1);
  await assert.rejects(service.complete(email, '012345', create), { status: 400 });
  assert.equal(created, 1);
  entry = { digest: service.digest(email, '012345'), attempts: 5, expiresAt: new Date(Date.now() + 10000) };
  await assert.rejects(service.complete(email, '012345', create), { status: 400 });
  entry = { digest: service.digest(email, '012345'), attempts: 0, expiresAt: new Date(0) };
  await assert.rejects(service.complete(email, '012345', create), { status: 400 });
  assert.equal(created, 1);
});
