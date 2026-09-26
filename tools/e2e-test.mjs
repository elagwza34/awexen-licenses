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

  // ---- 4. Subscription --------------------------------------------------
  console.log('\n[4] Subscription');

  const subscription = await call('POST', '/subscriptions', {
    customerId, planId: plan.id, price: 49900, currency: 'EGP', billingInterval: 'YEARLY',
  });
  check('subscription created (201)', subscription.status === 201,
    `status ${subscription.status}: ${JSON.stringify(subscription.body).slice(0, 200)}`);
  const subscriptionId = subscription.body?.id;
  check('the expiry derives from the YEARLY interval', Boolean(subscription.body?.expiresAt));
  check('it starts ACTIVE', subscription.body?.status === 'ACTIVE', subscription.body?.status);
  check('it carries the plan entitlements', subscription.body?.featureKeys?.length === 7);

  // ---- 5. Licence issuance ----------------------------------------------
  console.log('\n[5] Licence issuance');

  const licence = await call('POST', '/licenses', {
    customerId, planId: plan.id, subscriptionId, maxDevices: 2, notes: 'e2e run',
  });
  check('licence issued (201)', licence.status === 201, `got ${licence.status}`);
  const licenceId = licence.body?.id;
  const licenceKey = licence.body?.licenseKey;

  check('a formatted key was generated', /^PROD(-[A-Z0-9]{4}){4}$/.test(licenceKey ?? ''), licenceKey);
  check('the new licence is ACTIVE', licence.body?.derivedStatus === 'ACTIVE', licence.body?.derivedStatus);
  check('the device limit is honoured (2)', licence.body?.maxDevices === 2, `got ${licence.body?.maxDevices}`);
  check('it is bound to the subscription', licence.body?.subscriptionId === subscriptionId);
  check('the licence expiry matches the subscription',
    licence.body?.expiresAt === subscription.body?.expiresAt,
    `${licence.body?.expiresAt} vs ${subscription.body?.expiresAt}`);

  const payload = await call('GET', `/licenses/${licenceId}/payload`);
  check('a signed payload is available', payload.status === 200 && Boolean(payload.body?.signature));
  check('the payload lists the plan entitlements', payload.body?.payload?.features?.length === 7);
  check('only the public key is ever returned',
    payload.body?.publicKey?.includes('BEGIN PUBLIC KEY') && !payload.body?.publicKey?.includes('PRIVATE'));
  check('THE SIGNATURE VERIFIES against the public key', verifySignature(payload.body));

  const lookup = await call('GET', `/licenses/by-key/${licenceKey.toLowerCase()}`);
  check('key lookup is case-insensitive', lookup.status === 200 && lookup.body?.id === licenceId);


  // ---- 6. Public validation (the customer app's endpoint) ----------------
  console.log('\n[6] Public licence validation');

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

  // ---- 7. Renewal --------------------------------------------------------
  console.log('\n[7] Renewal');

  const beforeExpiry = (await call('GET', `/licenses/${licenceId}`)).body?.expiresAt;
  const renew = await call('POST', `/licenses/${licenceId}/renew`, { billingInterval: 'YEARLY', periods: 1 });
  check('renewal succeeds', renew.status === 201 || renew.status === 200,
    `status ${renew.status}: ${JSON.stringify(renew.body).slice(0, 220)}`);
  const afterExpiry = (await call('GET', `/licenses/${licenceId}`)).body?.expiresAt;
  check('the expiry moves forward', new Date(afterExpiry) > new Date(beforeExpiry),
    `${beforeExpiry} -> ${afterExpiry}`);
  check('the licence stays active after renewal',
    (await call('GET', `/licenses/${licenceId}`)).body?.derivedStatus === 'ACTIVE');

  // ---- 8. Suspend / reactivate -------------------------------------------
  console.log('\n[8] Suspend and reactivate');

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


  // ---- 9. Revoke is terminal ---------------------------------------------
  console.log('\n[9] Revoke (terminal)');

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

  // ---- 10. Payments ------------------------------------------------------
  console.log('\n[10] Payments');

  const reference = `E2E-TXN-${stamp}`;
  const payment = await call('POST', '/payments', {
    customerId, subscriptionId, amount: 49900, currency: 'EGP',
    method: 'BANK_TRANSFER', transactionReference: reference,
  });
  check('payment recorded (201)', payment.status === 201,
    `status ${payment.status}: ${JSON.stringify(payment.body).slice(0, 200)}`);
  const paymentId = payment.body?.id;
  check('it starts PENDING', payment.body?.status === 'PENDING', payment.body?.status);

  const dupe = await call('POST', '/payments', { customerId, amount: 1000, transactionReference: reference });
  check('a duplicate transaction reference is rejected (409)', dupe.status === 409, `got ${dupe.status}`);

  const crossCustomer = await call('POST', '/payments', { customerId: 999999, subscriptionId, amount: 1000 });
  check('a payment for a missing customer fails', crossCustomer.status >= 400);

  const expiryBefore = (await call('GET', `/subscriptions/${subscriptionId}`)).body?.expiresAt;
  const verified = await call('POST', `/payments/${paymentId}/verify`, { renewSubscription: true });
  check('payment verified', verified.status === 200, `got ${verified.status}`);
  check('it becomes PAID', verified.body?.status === 'PAID', verified.body?.status);

  const expiryAfter = (await call('GET', `/subscriptions/${subscriptionId}`)).body?.expiresAt;
  check('verifying with renewal extended the subscription',
    new Date(expiryAfter) > new Date(expiryBefore), `${expiryBefore} -> ${expiryAfter}`);

  const editPaid = await call('PUT', `/payments/${paymentId}`, { amount: 1 });
  check('a verified payment CANNOT be edited (409)', editPaid.status === 409, `got ${editPaid.status}`);

  const reVerify = await call('POST', `/payments/${paymentId}/verify`, {});
  check('it cannot be verified twice (409)', reVerify.status === 409, `got ${reVerify.status}`);

  const overRefund = await call('POST', `/payments/${paymentId}/refund`, {
    amount: 999999, reason: 'over-refund attempt',
  });
  check('refunding more than was paid is rejected (400)', overRefund.status === 400, `got ${overRefund.status}`);

  const partial = await call('POST', `/payments/${paymentId}/refund`, { amount: 9900, reason: 'partial' });
  check('a partial refund succeeds', partial.status === 200, `got ${partial.status}`);
  check('it stays PAID while partly refunded', partial.body?.status === 'PAID', partial.body?.status);
  check('the refunded amount is recorded, not overwritten',
    partial.body?.refundedAmount === 9900, `got ${partial.body?.refundedAmount}`);

  const paymentActions = ((await call('GET', `/audit-logs/entity/PAYMENT/${paymentId}`)).body?.data ?? [])
    .map((a) => a.action);
  check('payment verification is audited', paymentActions.includes('payment.verified'));
  check('the refund is audited', paymentActions.includes('payment.refunded'));

  // ---- 11. Subscription / licence consistency ---------------------------
  // A second, independent subscription is used here on purpose: the licence
  // from earlier in the run has been REVOKED, and a revoked licence is
  // deliberately excluded from renewal, so it must NOT be expected to match
  // its subscription any more.
  console.log('\n[11] Subscription and licence stay in sync');

  const subB = await call('POST', '/subscriptions', {
    customerId, planId: plan.id, price: 49900, currency: 'EGP', billingInterval: 'YEARLY',
  });
  check('a second subscription is created', subB.status === 201, `got ${subB.status}`);
  const subBId = subB.body?.id;

  const licB = await call('POST', '/licenses', { customerId, planId: plan.id, subscriptionId: subBId, maxDevices: 2 });
  check('its licence is issued', licB.status === 201, `got ${licB.status}`);
  check('the licence inherits the subscription expiry',
    licB.body?.expiresAt === subB.body?.expiresAt,
    `${licB.body?.expiresAt} vs ${subB.body?.expiresAt}`);

  const beforeB = (await call('GET', `/subscriptions/${subBId}`)).body?.expiresAt;
  await call('POST', `/subscriptions/${subBId}/renew`, { periods: 1 });
  const afterB = (await call('GET', `/subscriptions/${subBId}`)).body?.expiresAt;
  const licBAfter = (await call('GET', `/licenses/${licB.body?.id}`)).body?.expiresAt;
  check('renewing the subscription pushes the new date to its licence',
    licBAfter === afterB, `${licBAfter} vs ${afterB}`);
  check('the renewal actually moved the date', new Date(afterB) > new Date(beforeB));

  const subBSuspend = await call('POST', `/subscriptions/${subBId}/suspend`, { reason: 'e2e' });
  check('the subscription suspends', subBSuspend.status === 201 || subBSuspend.status === 200,
    `got ${subBSuspend.status}`);
  check('its licence is suspended too',
    (await call('GET', `/licenses/${licB.body?.id}`)).body?.derivedStatus === 'SUSPENDED');

  const subBReactivate = await call('POST', `/subscriptions/${subBId}/reactivate`, { reason: 'e2e' });
  check('the subscription reactivates', subBReactivate.status === 201 || subBReactivate.status === 200,
    `got ${subBReactivate.status}`);
  check('its licence is active again',
    (await call('GET', `/licenses/${licB.body?.id}`)).body?.derivedStatus === 'ACTIVE');

  const subBAudit = ((await call('GET', `/audit-logs/entity/SUBSCRIPTION/${subBId}`)).body?.data ?? [])
    .map((a) => a.action);
  check('the subscription renewal is audited', subBAudit.includes('subscription.renewed'));
  check('the suspension is audited', subBAudit.includes('subscription.suspended'));
  check('the reactivation is audited', subBAudit.includes('subscription.reactivated'));

  // ---- 12. Devices, support, releases -----------------------------------
  console.log('\n[12] Devices, support and releases');

  const devices = await call('GET', '/devices');
  check('devices are listed', devices.status === 200);
  check('fingerprint hashes are never exposed in full',
    (devices.body?.data ?? []).every((d) => (d.deviceFingerprint ?? '').length <= 12));
  check('device utilisation is computed',
    (await call('GET', '/devices/utilisation')).status === 200);

  const ticket = await call('POST', '/support', {
    customerId, subject: 'E2E ticket', message: 'Please help', priority: 'HIGH',
  });
  check('support ticket opened (201)', ticket.status === 201, `got ${ticket.status}`);
  check('it gets a sequential number', /^TKT-\d{4}-\d{6}$/.test(ticket.body?.number ?? ''), ticket.body?.number);
  check('an internal note can be added',
    (await call('POST', `/support/${ticket.body?.id}/reply`, { body: 'Looking', type: 'INTERNAL_NOTE' })).status === 200);

  const version = await call('POST', '/releases', {
    version: '1.0.0', buildNumber: stamp % 100000, platform: 'WINDOWS',
    downloadUrl: 'https://example.com/a.exe',
  });
  check('release draft created (201)', version.status === 201,
    `status ${version.status}: ${JSON.stringify(version.body).slice(0, 160)}`);
  check('a new release starts as DRAFT', version.body?.status === 'DRAFT', version.body?.status);
  check('a duplicate version/build is rejected',
    (await call('POST', '/releases', {
      version: '1.0.0', buildNumber: stamp % 100000, platform: 'WINDOWS',
    })).status >= 400);

  const published = await call('POST', `/releases/${version.body?.id}/publish`, {});
  check('the release publishes', published.status === 200, `got ${published.status}`);
  check('it becomes PUBLISHED', published.body?.status === 'PUBLISHED', published.body?.status);
  check('the customer app can read a published build',
    (await call('GET', '/releases/latest?platform=WINDOWS')).body?.data?.version === '1.0.0');

  // ---- 13. Analytics ----------------------------------------------------
  console.log('\n[13] Analytics');

  const overview = await call('GET', '/analytics/overview');
  check('the overview is served', overview.status === 200);
  check('it counts the real customer total', overview.body?.customers?.total >= 1);
  check('it reports a currency', typeof overview.body?.currency === 'string');
  check('the expiration report is served', (await call('GET', '/licenses/expiring?filter=30d')).status === 200);
  check('the payment summary reflects the verified payment',
    (await call('GET', '/payments/summary')).body?.monthCount >= 1);

  // ---- 14. Input validation ---------------------------------------------
  console.log('\n[14] Input validation');

  check('an invalid email is rejected (400)',
    (await call('POST', '/customers', { name: 'X', email: 'not-an-email' })).status === 400);
  check('an unknown field is rejected (mass-assignment guard)',
    (await call('POST', '/customers', { name: 'MA', email: `ma-${stamp}@test.local`, id: 999 })).status === 400);
  check('issuing against a missing customer fails',
    (await call('POST', '/licenses', { customerId: 999999, planId: 1 })).status >= 400);
  check('a negative payment is rejected (400)',
    (await call('POST', '/payments', { customerId, amount: -100 })).status === 400);


  console.log(`\n${'='.repeat(56)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('='.repeat(56));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('E2E run failed:', error);
  process.exit(1);
});
