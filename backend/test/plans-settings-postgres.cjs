require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { PlansService } = require('../src/plans/plans.service');
const { SettingsService } = require('../src/settings/settings.service');
const { AuditService } = require('../src/common/audit/audit.service');

test('isolated PostgreSQL: durable settings and removal with real historical foreign keys', async () => {
  const url = new URL(process.env.PMS_LMS_TEST_URL || '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.username, 'pms_remediation_test_admin');
  assert.notEqual(url.port, '5432'); assert.match(url.pathname, /^\/pms_lms_test_[0-9a-f]{32}$/);
  const options = { datasources: { db: { url: url.toString() } } };
  const db = new PrismaClient(options);
  try {
    const actual = await db.$queryRawUnsafe('SHOW data_directory');
    assert.equal(path.resolve(actual[0].data_directory).toLowerCase(), path.resolve(process.env.PMS_TEST_DATA_DIRECTORY).toLowerCase());
    const admin = await db.admin.create({ data: { email: 'settings-admin@example.invalid', name: 'Synthetic admin', passwordHash: 'synthetic-only' } });
    const actor = { id: admin.id, email: admin.email }, req = { ip: '127.0.0.1', headers: {} };
    const audit = new AuditService(db);
    await db.setting.create({ data: { key: 'company.name', type: 'STRING', value: 'Before', group: 'company' } });
    const settings = new SettingsService(db, audit, { refreshSettings: async () => {} }, { refreshSettings: async () => {} });
    await settings.update('company.name', { value: 'Saved durably' }, actor, req);
    const reconnected = new PrismaClient(options);
    try { assert.equal((await reconnected.setting.findUniqueOrThrow({ where: { key: 'company.name' } })).value, 'Saved durably'); }
    finally { await reconnected.$disconnect(); }
    const service = new PlansService(db, audit);
    const createPlan = key => db.plan.create({ data: { key, name: key, price: 100 } });
    const unused = await createPlan('UNUSED');
    assert.equal((await service.remove(unused.id, actor, req)).deleted, true);
    assert.equal(await db.plan.findUnique({ where: { id: unused.id } }), null);
    const customer = await db.customer.create({ data: { name: 'Synthetic buyer', email: 'settings-buyer@example.invalid' } });
    const expired = await createPlan('EXPIRED_SUBSCRIPTION');
    await db.subscription.create({ data: { customerId: customer.id, planId: expired.id, status: 'EXPIRED', startsAt: new Date(0), expiresAt: new Date(86400000), price: 100 } });
    assert.equal((await service.remove(expired.id, actor, req)).archived, true);
    assert.equal(await db.subscription.count({ where: { planId: expired.id } }), 1);
    const historical = await createPlan('HISTORICAL_PAYMENT');
    await db.payment.create({ data: { customerId: customer.id, planId: historical.id, amount: 100, currency: 'EGP', status: 'PAID', method: 'BANK_TRANSFER' } });
    assert.equal((await service.remove(historical.id, actor, req)).archived, true);
    assert.equal(await db.payment.count({ where: { planId: historical.id } }), 1);
    const licensed = await createPlan('LICENSED');
    await db.license.create({ data: { licenseKey: 'SYNTHETIC-SETTINGS-LICENSE', customerId: customer.id, planId: licensed.id, status: 'ACTIVE', startsAt: new Date(0) } });
    assert.equal((await service.remove(licensed.id, actor, req)).archived, true);
    assert.equal((await db.license.findUniqueOrThrow({ where: { licenseKey: 'SYNTHETIC-SETTINGS-LICENSE' } })).status, 'ACTIVE');
    assert.equal(await db.auditLog.count({ where: { action: 'setting.updated' } }), 1);
    assert.equal(await db.auditLog.count({ where: { action: 'plan.archived_instead_of_delete' } }), 3);
  } finally { await db.$disconnect(); }
});
