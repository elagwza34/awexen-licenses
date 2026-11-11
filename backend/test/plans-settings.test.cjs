require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ValidationPipe } = require('@nestjs/common');
const { Test } = require('@nestjs/testing');
const request = require('supertest');
const { PlansService } = require('../src/plans/plans.service');
const { SettingsService, UpdateSettingDto, BulkUpdateSettingsDto } = require('../src/settings/settings.service');
const { SettingsController } = require('../src/settings/settings.controller');
const pipe = () => new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true,
  transformOptions: { enableImplicitConversion: false }, validationError: { target: false, value: false } });

test('production DTO whitelist accepts setting values including false/zero and rejects unknown or missing fields', async () => {
  const meta = { type: 'body', metatype: UpdateSettingDto };
  for (const value of ['New company', 0, false]) assert.equal((await pipe().transform({ value }, meta)).value, value);
  await assert.rejects(pipe().transform({ value: 'x', admin: true }, meta));
  await assert.rejects(pipe().transform({}, meta));
  const bulk = { type: 'body', metatype: BulkUpdateSettingsDto };
  assert.equal((await pipe().transform({ settings: [{ key: 'company.name', value: 'Saved' }] }, bulk)).settings[0].value, 'Saved');
  await assert.rejects(pipe().transform({ settings: [{ key: 'company.name', value: 'Saved', unknown: true }] }, bulk));
});

test('settings HTTP save persists and reloads, keeps auditing/runtime refresh and rejects invalid numbers', async () => {
  const rows = new Map([
    ['company.name', { key: 'company.name', type: 'STRING', value: 'Before', group: 'company', isSensitive: false }],
    ['license.count', { key: 'license.count', type: 'NUMBER', value: 1, group: 'license', isSensitive: false }],
    ['system.enabled', { key: 'system.enabled', type: 'BOOLEAN', value: true, group: 'system', isSensitive: false }],
  ]);
  let audited = 0, refreshed = 0;
  const tx = { setting: { update: async ({ where, data }) => { const row = { ...rows.get(where.key), ...data }; rows.set(where.key, row); return row; } } };
  const prisma = { setting: { findUnique: async ({ where }) => rows.get(where.key), findMany: async () => [...rows.values()] },
    $transaction: async action => action(tx) };
  const service = new SettingsService(prisma, { record: async () => { audited++; } },
    { refreshSettings: async () => { refreshed++; } }, { refreshSettings: async () => { refreshed++; } });
  const module = await Test.createTestingModule({ controllers: [SettingsController], providers: [{ provide: SettingsService, useValue: service }] }).compile();
  const app = module.createNestApplication(); app.useGlobalPipes(pipe());
  // Supply only a synthetic administrator, never real authentication credentials.
  app.use((req, _res, next) => { req.admin = { id: 1, email: 'fixture@example.invalid' }; next(); });
  await app.init();
  try {
    await request(app.getHttpServer()).put('/settings/company.name').send({ value: 'After' }).expect(200);
    assert.equal((await request(app.getHttpServer()).get('/settings/company.name').expect(200)).body.value, 'After');
    await request(app.getHttpServer()).put('/settings/license.count').send({ value: 0 }).expect(200);
    await request(app.getHttpServer()).put('/settings/system.enabled').send({ value: false }).expect(200);
    const saved = (await request(app.getHttpServer()).get('/settings').expect(200)).body.data;
    assert.equal(saved.find(row => row.key === 'license.count').value, 0);
    assert.equal(saved.find(row => row.key === 'system.enabled').value, false);
    await request(app.getHttpServer()).put('/settings/license.count').send({ value: '' }).expect(400);
    await request(app.getHttpServer()).put('/settings/license.count').send({ value: false }).expect(400);
    await request(app.getHttpServer()).put('/settings/company.name').send({ value: 'Forged', extra: true }).expect(400);
    assert.equal(rows.get('company.name').value, 'After');
    assert.equal(audited, 3); assert.equal(refreshed, 6);
  } finally { await app.close(); }
});

for (const [name, references] of Object.entries({ unused: [0, 0, 0], licence: [1, 0, 0], expiredSubscription: [0, 1, 0], historicalPayment: [0, 0, 1] })) {
  test(`plan removal: ${name} preserves historical references and audits the mutation`, async () => {
    let locked = false, deleted = false, archived = false, action;
    const tx = { $queryRaw: async () => { locked = true; return []; },
      plan: { findUniqueOrThrow: async () => { assert.equal(locked, true); return { id: 1, status: 'ACTIVE' }; },
        update: async ({ data }) => { archived = true; return { id: 1, ...data }; }, delete: async () => { deleted = true; } },
      license: { count: async () => references[0] }, subscription: { count: async ({ where }) => { assert.equal(where.status, undefined); return references[1]; } },
      payment: { count: async () => references[2] } };
    const service = new PlansService({ $transaction: async callback => callback(tx) }, { record: async data => { action = data.action; assert.equal(data.tx, tx); } });
    const result = await service.remove(1, { id: 1 }, {});
    assert.equal(result.archived, references.some(Boolean)); assert.equal(result.deleted, !references.some(Boolean));
    assert.equal(deleted, result.deleted); assert.equal(archived, result.archived);
    assert.equal(action, archived ? 'plan.archived_instead_of_delete' : 'plan.deleted');
  });
}

test('saving one setting preserves edits in other rows and newer typing during an in-flight save', () => {
  const ts = require('typescript'); const helper = { exports: {} };
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../frontend/src/lib/settings-drafts.ts'), 'utf8');
  new Function('exports', 'require', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(helper.exports, require, helper);
  const { clearSavedDraft } = helper.exports;
  const drafts = { 'company.name': 'New', 'company.phone': '123' };
  assert.deepEqual(clearSavedDraft(drafts, 'company.name', 'New'), { 'company.phone': '123' });
  assert.deepEqual(drafts, { 'company.name': 'New', 'company.phone': '123' });
  assert.equal(clearSavedDraft(drafts, 'company.name', 'Earlier submitted value'), drafts);
});
