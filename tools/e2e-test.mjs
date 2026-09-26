/**
 * End-to-end test against a running API and a real database.
 *
 *   node tools/e2e-test.mjs
 *
 * Exercises the full commercial lifecycle over HTTP:
 *   sign in -> create customer -> issue licence -> validate (the customer-app
 *   endpoint) -> renew -> suspend -> reactivate -> revoke -> confirm that
 *   revocation is terminal, then check the audit trail and analytics.
 *
 * Every assertion reads real data back from the API. Nothing is mocked.
 */
import { createPublicKey, verify } from 'node:crypto';

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'owner@company.com';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!Owner2026';

let passed = 0;
let failed = 0;
let accessToken = null;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    // Written to stdout too, so the failure is never lost in a piped run.
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, body, token = accessToken) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

/** Verifies the licence signature with the public key the API returned. */
function verifySignature(payload) {
  if (!payload?.signature || !payload?.publicKey) return false;
  try {
    const key = createPublicKey(payload.publicKey);
    const canonical = JSON.stringify({
      licenseKey: payload.payload.licenseKey,
      planKey: payload.payload.planKey,
      edition: payload.payload.edition,
      features: [...payload.payload.features].sort(),
      maxDevices: payload.payload.maxDevices,
      issuedAt: payload.payload.issuedAt,
      expiresAt: payload.payload.expiresAt,
      version: payload.payload.version,
    });
    return verify('sha256', Buffer.from(canonical), key, Buffer.from(payload.signature, 'base64'));
  } catch {
    return false;
  }
}

async function main() {
  const stamp = Date.now();
  const customerEmail = `e2e-${stamp}@test.local`;

  // ---- 1. Authentication -------------------------------------------------
  console.log('\n[1] Authentication');

  const bad = await call('POST', '/auth/login', { email: EMAIL, password: 'wrong' }, null);
  check('wrong password rejected with 401', bad.status === 401, `got ${bad.status}`);
  check('the error does not reveal whether the account exists',
    bad.body?.error?.message === 'Invalid email or password', bad.body?.error?.message);

  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD }, null);
  check('valid credentials return 200', login.status === 200, `got ${login.status}`);
  accessToken = login.body?.tokens?.accessToken ?? null;
  check('an access token is issued', typeof accessToken === 'string' && accessToken.length > 40);
  check('the profile returns SUPER_ADMIN', login.body?.admin?.roles?.includes('SUPER_ADMIN'));
  check('all 42 permissions are granted', login.body?.admin?.permissions?.length === 42,
    `got ${login.body?.admin?.permissions?.length}`);

  const noToken = await call('GET', '/customers', undefined, null);
  check('protected routes reject a missing token (401)', noToken.status === 401, `got ${noToken.status}`);

  const me = await call('GET', '/auth/me');
  check('GET /auth/me works with the token', me.status === 200 && me.body?.email === EMAIL);


  // ---- 2. Seeded catalogue ----------------------------------------------
  console.log('\n[2] Seeded catalogue');

  const plans = await call('GET', '/plans');
  check('plans are seeded', plans.body?.data?.length >= 3, `got ${plans.body?.data?.length}`);
  const plan = plans.body?.data?.find((p) => p.key === 'PROFESSIONAL');
  check('the PROFESSIONAL plan exists', Boolean(plan));
  check('the plan carries real entitlements', plan?.featureKeys?.length === 7, `got ${plan?.featureKeys?.length}`);

  const features = await call('GET', '/features');
  check('features are seeded', features.body?.data?.length >= 11, `got ${features.body?.data?.length}`);

  const settings = await call('GET', '/settings');
  check('runtime settings are seeded', settings.body?.data?.length >= 15, `got ${settings.body?.data?.length}`);
  const grace = settings.body?.data?.find((s) => s.key === 'license.grace_period_days');
  check('the grace period is configurable (7 days)', Number(grace?.value) === 7, `got ${grace?.value}`);

  // ---- 3. Customer -------------------------------------------------------
  console.log('\n[3] Customer');

  const created = await call('POST', '/customers', {
    name: 'E2E Test Customer', company: 'E2E Industries', email: customerEmail, country: 'Egypt',
  });
  check('customer created (201)', created.status === 201, `got ${created.status}`);
  const customerId = created.body?.id;

  const duplicate = await call('POST', '/customers', { name: 'Dup', email: customerEmail });
  check('a duplicate email is rejected with 409', duplicate.status === 409, `got ${duplicate.status}`);

  const customer = await call('GET', `/customers/${customerId}`);
  check('the customer reads back', customer.status === 200 && customer.body?.email === customerEmail);
  check('a new customer has no licences', customer.body?.stats?.activeLicenses === 0);
  check('a new customer has no payment history', Number(customer.body?.stats?.totalPaid) === 0);

  // ---- 4. Licence issuance ----------------------------------------------
  console.log('\n[4] Licence issuance');

  const licence = await call('POST', '/licenses', { customerId, planId: plan.id, maxDevices: 2, notes: 'e2e run' });
  check('licence issued (201)', licence.status === 201, `got ${licence.status}`);
  const licenceId = licence.body?.id;
  const licenceKey = licence.body?.licenseKey;

  check('a formatted key was generated', /^PROD(-[A-Z0-9]{4}){4}$/.test(licenceKey ?? ''), licenceKey);
  check('the new licence is ACTIVE', licence.body?.derivedStatus === 'ACTIVE', licence.body?.derivedStatus);
  check('the expiry is derived from the plan interval', Boolean(licence.body?.expiresAt));
  check('the device limit is honoured (2)', licence.body?.maxDevices === 2, `got ${licence.body?.maxDevices}`);
  check('no device is registered yet', licence.body?.activeDevices === 0);

  const payload = await call('GET', `/licenses/${licenceId}/payload`);
  check('a signed payload is available', payload.status === 200 && Boolean(payload.body?.signature));
  check('the payload lists the plan entitlements', payload.body?.payload?.features?.length === 7);
  check('only the public key is ever returned',
    payload.body?.publicKey?.includes('BEGIN PUBLIC KEY') && !payload.body?.publicKey?.includes('PRIVATE'));
  check('THE SIGNATURE VERIFIES against the public key', verifySignature(payload.body));

  const lookup = await call('GET', `/licenses/by-key/${licenceKey.toLowerCase()}`);
  check('key lookup is case-insensitive', lookup.status === 200 && lookup.body?.id === licenceId);


  // ---- 5. Public validation (the customer app's endpoint) ----------------
  console.log('\n[5] Public licence validation');

  const device = 'e2e-machine-alpha';
  const v1 = await call('POST', '/validations/validate',
    { licenseKey: licenceKey, deviceFingerprint: device, deviceName: 'Test PC', appVersion: '1.0.0' }, null);
  check('validation returns 200', v1.status === 200, `got ${v1.status}`);
  check('the licence validates successfully', v1.body?.valid === true, v1.body?.message);
  check('an offline lease is issued', typeof v1.body?.validUntil === 'string');
  check('the signed payload is returned', Boolean(v1.body?.signature) && Boolean(v1.body?.payload));
  check('the public key accompanies it', v1.body?.publicKey?.includes('BEGIN PUBLIC KEY'));

  const v2 = await call('POST', '/validations/validate',
    { licenseKey: licenceKey, deviceFingerprint: device }, null);
  check('the same device validates again', v2.body?.valid === true);
  check('revalidation does not consume a second slot',
    (await call('GET', `/licenses/${licenceId}`)).body?.activeDevices === 1);

  const v3 = await call('POST', '/validations/validate',
    { licenseKey: licenceKey, deviceFingerprint: 'e2e-machine-beta' }, null);
  check('a second device fits within the limit of 2', v3.body?.valid === true, v3.body?.message);

  const v4 = await call('POST', '/validations/validate',
    { licenseKey: licenceKey, deviceFingerprint: 'e2e-machine-gamma' }, null);
  check('a third device is rejected with DEVICE_LIMIT',
    v4.body?.valid === false && v4.body?.status === 'DEVICE_LIMIT', String(v4.body?.status));
  check('a rejected device receives no payload', v4.body?.payload === null);

  const unknown = await call('POST', '/validations/validate',
    { licenseKey: 'PROD-XXXX-XXXX-XXXX-XXXX', deviceFingerprint: 'unknown-machine' }, null);
  check('an unknown key returns INVALID', unknown.body?.status === 'INVALID');
  check('an unknown key still returns 200 so the client gets a verdict',
    unknown.status === 200, `got ${unknown.status}`);

  // ---- 6. Renewal --------------------------------------------------------
  console.log('\n[6] Renewal');

  const beforeExpiry = (await call('GET', `/licenses/${licenceId}`)).body?.expiresAt;
  const renew = await call('POST', `/licenses/${licenceId}/renew`, { billingInterval: 'YEARLY', periods: 1 });
  check('renewal succeeds', renew.status === 201 || renew.status === 200,
    `status ${renew.status}: ${JSON.stringify(renew.body).slice(0, 220)}`);
  const afterExpiry = (await call('GET', `/licenses/${licenceId}`)).body?.expiresAt;
  check('the expiry moves forward', new Date(afterExpiry) > new Date(beforeExpiry),
    `${beforeExpiry} -> ${afterExpiry}`);
  check('the licence stays active after renewal',
    (await call('GET', `/licenses/${licenceId}`)).body?.derivedStatus === 'ACTIVE');

  // ---- 7. Suspend / reactivate -------------------------------------------
  console.log('\n[7] Suspend and reactivate');

  const suspend = await call('POST', `/licenses/${licenceId}/suspend`, { reason: 'e2e test' });
  check('suspension succeeds', suspend.status === 201 || suspend.status === 200, `got ${suspend.status}`);
  check('the status becomes SUSPENDED', suspend.body?.derivedStatus === 'SUSPENDED');

  const suspended = await call('POST', '/validations/validate',
    { licenseKey: licenceKey, deviceFingerprint: device }, null);
  check('a suspended licence fails validation',
    suspended.body?.valid === false && suspended.body?.status === 'SUSPENDED', suspended.body?.status);

  const reactivate = await call('POST', `/licenses/${licenceId}/reactivate`, { reason: 'e2e test' });
  check('reactivation succeeds', reactivate.status === 201 || reactivate.status === 200);
  check('the licence is active again', reactivate.body?.derivedStatus === 'ACTIVE');


  // ---- 8. Revoke is terminal ---------------------------------------------
  console.log('\n[8] Revoke (terminal)');

  const revoke = await call('POST', `/licenses/${licenceId}/revoke`, { reason: 'e2e cleanup' });
  check('revocation succeeds', revoke.status === 201 || revoke.status === 200, `got ${revoke.status}`);
  check('the status becomes REVOKED', revoke.body?.derivedStatus === 'REVOKED');

  const retry = await call('POST', `/licenses/${licenceId}/reactivate`, {});
  check('a revoked licence CANNOT be reactivated (409)', retry.status === 409, `got ${retry.status}`);

  const revoked = await call('POST', '/validations/validate',
    { licenseKey: licenceKey, deviceFingerprint: device }, null);
  check('a revoked licence fails validation',
    revoked.body?.valid === false && revoked.body?.status === 'REVOKED', revoked.body?.status);

  const retained = await call('GET', `/licenses/${licenceId}`);
  check('the revoked licence is retained, not deleted', retained.status === 200);
  check('it carries the revocation reason', retained.body?.revokedReason === 'e2e cleanup');

  // ---- 9. Audit trail ----------------------------------------------------
  console.log('\n[9] Audit trail');

  const audit = await call('GET', `/audit-logs/entity/LICENSE/${licenceId}`);
  const actions = (audit.body?.data ?? []).map((a) => a.action);
  check('audit entries exist for the licence', actions.length >= 5,
    `got ${actions.length}: ${actions.join(', ')}`);
  check('issuance is audited', actions.includes('license.created'));
  check('renewal is audited', actions.includes('license.renewed'));
  check('suspension is audited', actions.includes('license.suspended'));
  check('reactivation is audited', actions.includes('license.reactivated'));
  check('revocation is audited', actions.includes('license.revoked'));
  check('each entry records which admin acted',
    (audit.body?.data ?? []).every((a) => a.adminEmail === EMAIL));

  const cAudit = await call('GET', `/audit-logs/entity/CUSTOMER/${customerId}`);
  check('customer creation is audited',
    (cAudit.body?.data ?? []).some((a) => a.action === 'customer.created'));

  // ---- 10. Analytics reflect real data -----------------------------------
  console.log('\n[10] Analytics');

  const overview = await call('GET', '/analytics/overview');
  check('the overview is served', overview.status === 200);
  check('it counts the real customer total', overview.body?.customers?.total >= 1);
  check('it reports a currency', typeof overview.body?.currency === 'string');
  check('the expiration report is served', (await call('GET', '/licenses/expiring?filter=30d')).status === 200);

  // ---- 11. Input validation ----------------------------------------------
  console.log('\n[11] Input validation');

  const badEmail = await call('POST', '/customers', { name: 'X', email: 'not-an-email' });
  check('an invalid email is rejected (400)', badEmail.status === 400, `got ${badEmail.status}`);

  const massAssign = await call('POST', '/customers', { name: 'MassAssign', email: `ma-${stamp}@test.local`, id: 999 });
  check('an unknown field is rejected (mass-assignment guard)',
    massAssign.status === 400, `got ${massAssign.status}`);

  const missing = await call('POST', '/licenses', { customerId: 999999, planId: 1 });
  check('issuing against a missing customer fails', missing.status >= 400, `got ${missing.status}`);

  console.log(`\n${'='.repeat(56)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('='.repeat(56));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('E2E run failed:', error);
  process.exit(1);
});
