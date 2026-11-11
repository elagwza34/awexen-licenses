require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, verify } = require('node:crypto');
const { PlansService } = require('../src/plans/plans.service');
const { PmsInstallationsService } = require('../src/licenses/pms-installations.service');
const { validatePmsPolicy, PMS_FEATURES } = require('../src/plans/pms-plan-policy');
const ts = require('typescript');
const helperModule = { exports: {} };
const helperSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../frontend/src/lib/pms-plan-features.ts'), 'utf8');
new Function('exports', 'require', 'module', ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(helperModule.exports, require, helperModule);
const { validatePmsSelection, PMS_FEATURE_LABELS } = helperModule.exports;
const { CustomerPortalService } = require('../src/customer-portal/customer-portal.service');

test('admin feature checklist and issuer agree on supported features and dependencies', () => {
  assert.deepEqual(Object.keys(PMS_FEATURE_LABELS).sort(), Object.keys(PMS_FEATURES).sort());
  const limits = { maxBranches: 1, maxWarehouses: 1 };
  for (const feature of Object.keys(PMS_FEATURES)) {
    for (const keys of [['PRODUCTS', feature], Object.keys(PMS_FEATURES), ['PRODUCTS', 'UNSUPPORTED']])
      assert.equal(Boolean(validatePmsSelection(keys, 1, 1)), Boolean(validatePmsPolicy(keys, limits)));
  }
  assert.ok(validatePmsSelection(['PRODUCTS'], 2, 1));
  assert.ok(validatePmsSelection(['PRODUCTS'], 1, 2));
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.ok(validatePmsPolicy(['PRODUCTS', key], limits));
    assert.ok(validatePmsSelection(['PRODUCTS', key], 1, 1));
  }
});

test('new or edited selected-feature plans cannot silently disable PMS enforcement', async () => {
  const service = new PlansService({}, {});
  await assert.rejects(service.create({ enforceEntitlements: false }, {}, {}), /PMS/);
  for (const existing of [{ enforceEntitlements: true }, { enforceEntitlements: false }])
    await assert.rejects(service.validatePolicy({ enforceEntitlements: false, featureIds: [1] }, existing), /PMS/);
  await service.validatePolicy({ name: 'Legacy metadata' }, { enforceEntitlements: false });
});

test('saved selections replace prior features and are exactly signed into the customer server grant', async () => {
  const features = ['PRODUCTS', 'EMPLOYEES', 'ATTENDANCE'].map((key, i) => ({ id: i + 1, key }));
  let plan, version = 1, selected = [];
  const tx = {
    plan: {
      create: async ({ data }) => (plan = { id: 7, ...data, maxUsers: 3, maxBranches: 1, maxWarehouses: 1,
        features: data.features.create.map(x => ({ feature: features.find(f => f.id === x.featureId) })) }),
      update: async ({ data }) => (plan = { ...plan, ...data, features: selected.map(id => ({ feature: features.find(f => f.id === id) })) }),
    },
    planFeature: { deleteMany: async () => { selected = []; }, createMany: async ({ data }) => { selected = data.map(x => x.featureId); } },
    license: { updateMany: async () => { version++; } },
  };
  const db = { feature: { findMany: async ({ where }) => features.filter(f => where.id.in.includes(f.id)) },
    plan: { findUnique: async () => null, findUniqueOrThrow: async () => plan },
    $transaction: async callback => callback(tx) };
  const service = new PlansService(db, { record: async () => {} });
  await service.create({ key: 'CUSTOM_PLAN', name: 'Custom', price: 100, featureIds: [1, 2, 3] }, {}, {});
  assert.equal(plan.enforceEntitlements, true);
  assert.deepEqual(plan.features.map(x => x.feature.key), ['PRODUCTS', 'EMPLOYEES', 'ATTENDANCE']);
  await service.update(7, { featureIds: [1] }, {}, {});
  assert.equal(version, 2);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signed = { signDocument: value => {
    const document = JSON.stringify(value);
    return { document, signature: sign('sha256', Buffer.from(document), privateKey).toString('base64') };
  } };
  const license = { id: 8, licenseKey: 'FIXTURE', customer: { status: 'ACTIVE' }, status: 'ACTIVE',
    startsAt: new Date(0), expiresAt: null, version, maxDevices: 1, plan };
  const issuerTx = { $queryRaw: async parts => String(parts[0]).includes('pms_installations')
      ? [{ installation_id: '00000000-0000-0000-0000-000000000007', server_fingerprint: 'hash' }] : [],
    license: { findUnique: async () => license } };
  const issuer = new PmsInstallationsService({ $transaction: async callback => callback(issuerTx) }, signed, { hashFingerprint: () => 'hash' });
  const grant = await issuer.serverGrant('FIXTURE', 'server');
  assert.equal(verify('sha256', Buffer.from(grant.document), publicKey, Buffer.from(grant.signature, 'base64')), true);
  const value = JSON.parse(grant.document);
  assert.deepEqual(value.entitlements.features, ['PRODUCTS']);
  assert.equal(value.entitlements.enforced, true);
  assert.equal(value.version, 2);
  assert.equal(verify('sha256', Buffer.from(grant.document.replace('PRODUCTS', 'INVENTORY')), publicKey, Buffer.from(grant.signature, 'base64')), false);
});

test('customer cannot submit an unpublished unrestricted legacy plan by forging its id', async () => {
  let saved = false;
  const db = { customer: { findUniqueOrThrow: async () => ({ status: 'ACTIVE' }) },
    plan: { findUnique: async () => ({ id: 2, status: 'ACTIVE', price: 100, enforceEntitlements: false }) },
    payment: { create: async () => { saved = true; } } };
  const service = new CustomerPortalService(db, {}, {}, { get: (_key, fallback) => fallback });
  await assert.rejects(service.requestActivation(1, { planId: 2, amount: 100 }, {}), /not available/);
  assert.equal(saved, false);
});
