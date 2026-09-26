/**
 * Verifies the licence business rules against a fixed clock.
 *
 *   npm run verify:business
 *
 * `LicenseStatusService.derive()` and `daysRemaining()` are pure functions, so
 * the whole status matrix can be asserted without a database. This is the
 * module that decides whether a customer's software keeps working, so its edge
 * cases are pinned down here.
 */
import { LicenseStatus, SubscriptionStatus } from '@prisma/client';
import { LicenseStatusService } from '../src/licenses/license-status.service';
import { PrismaService } from '../src/common/prisma/prisma.service';

const DAY = 86_400_000;
const NOW = new Date('2026-09-26T12:00:00.000Z');

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY);
}

/** The service only touches Prisma in the DB-backed methods we skip here. */
const stubPrisma = { setting: { findMany: async () => [] } } as unknown as PrismaService;

const service = new LicenseStatusService(stubPrisma);
// Explicit, documented values so the expectations below are unambiguous.
service.setFallbacks(/* grace days */ 7, /* expiring window days */ 14);

const base = { startsAt: daysFromNow(-30), isTrial: false };

function derive(
  status: LicenseStatus,
  expiresAt: Date | null,
  isTrial = false,
): LicenseStatus {
  return service.derive({ ...base, status, expiresAt, isTrial }, NOW).status;
}

console.log('\n[1] Status derivation — the core matrix');

const matrix: Array<[string, LicenseStatus, LicenseStatus]> = [
  ['far-future expiry is ACTIVE', derive(LicenseStatus.ACTIVE, daysFromNow(90)), LicenseStatus.ACTIVE],
  ['expiry inside the 14-day window is EXPIRING', derive(LicenseStatus.ACTIVE, daysFromNow(10)), LicenseStatus.EXPIRING],
  ['expiry inside 7 days is EXPIRING', derive(LicenseStatus.ACTIVE, daysFromNow(3)), LicenseStatus.EXPIRING],
  ['expired 2 days ago is still EXPIRING (grace)', derive(LicenseStatus.ACTIVE, daysFromNow(-2)), LicenseStatus.EXPIRING],
  ['expired 6 days ago is still EXPIRING (grace edge)', derive(LicenseStatus.ACTIVE, daysFromNow(-6)), LicenseStatus.EXPIRING],
  ['expired 7 days ago is still EXPIRING (grace boundary)', derive(LicenseStatus.ACTIVE, daysFromNow(-7)), LicenseStatus.EXPIRING],
  ['expired 8 days ago is EXPIRED (past grace)', derive(LicenseStatus.ACTIVE, daysFromNow(-8)), LicenseStatus.EXPIRED],
  ['long-expired is EXPIRED', derive(LicenseStatus.ACTIVE, daysFromNow(-400)), LicenseStatus.EXPIRED],
  ['no expiry (lifetime) is ACTIVE', derive(LicenseStatus.ACTIVE, null), LicenseStatus.ACTIVE],
  ['trial flag yields TRIAL', derive(LicenseStatus.ACTIVE, daysFromNow(90), true), LicenseStatus.TRIAL],
];

for (const [name, actual, expected] of matrix) {
  check(name, actual === expected, `got ${actual}, want ${expected}`);
}


console.log('\n[2] Admin-forced states always win');

const forced = service.derive({ ...base, status: LicenseStatus.SUSPENDED, expiresAt: daysFromNow(-100) }, NOW);
check('a long-expired SUSPENDED licence stays SUSPENDED', forced.status === LicenseStatus.SUSPENDED);
check('a suspension reason is reported', typeof forced.reason === 'string' && forced.reason.length > 0);

const revoked = service.derive({ ...base, status: LicenseStatus.REVOKED, expiresAt: daysFromNow(90) }, NOW);
check('a REVOKED licence stays REVOKED even when unexpired', revoked.status === LicenseStatus.REVOKED);

console.log('\n[3] Expiry boundary is inclusive at exactly "now"');

const exactNow = derive(LicenseStatus.ACTIVE, NOW);
check('expiry exactly at now is not yet EXPIRED', exactNow !== LicenseStatus.EXPIRED, exactNow);
const oneSecondPast = derive(LicenseStatus.ACTIVE, new Date(NOW.getTime() - 1000));
check('one second past expiry enters grace (EXPIRING)', oneSecondPast === LicenseStatus.EXPIRING);

console.log('\n[4] daysRemaining');

check('future expiry floors the day count', service.daysRemaining(daysFromNow(10.5), NOW) === 10);
check('past expiry clamps at 0, never negative', service.daysRemaining(daysFromNow(-5), NOW) === 0);
check('lifetime licence reports null', service.daysRemaining(null, NOW) === null);
check('exact today reports 0', service.daysRemaining(NOW, NOW) === 0);

console.log('\n[5] Subscription derivation');

const subCases: Array<[string, SubscriptionStatus, Date | null, SubscriptionStatus]> = [
  ['future expiry stays ACTIVE', SubscriptionStatus.ACTIVE, daysFromNow(60), SubscriptionStatus.ACTIVE],
  ['past expiry becomes EXPIRED', SubscriptionStatus.ACTIVE, daysFromNow(-1), SubscriptionStatus.EXPIRED],
  ['CANCELLED is terminal', SubscriptionStatus.CANCELLED, daysFromNow(60), SubscriptionStatus.CANCELLED],
  ['SUSPENDED is terminal', SubscriptionStatus.SUSPENDED, daysFromNow(60), SubscriptionStatus.SUSPENDED],
  // A trial that has run past its end is genuinely over, so it expires.
  ['a TRIAL past its end becomes EXPIRED', SubscriptionStatus.TRIAL, daysFromNow(-1), SubscriptionStatus.EXPIRED],
  ['a TRIAL still running stays TRIAL', SubscriptionStatus.TRIAL, daysFromNow(5), SubscriptionStatus.TRIAL],
];

for (const [name, status, expiresAt, expected] of subCases) {
  const actual = service.deriveSubscription({ status, expiresAt }, NOW);
  check(name, actual === expected, `got ${actual}, want ${expected}`);
}

console.log('\n[6] Grace period is configurable, not hardcoded');

const strict = new LicenseStatusService(stubPrisma);
strict.setFallbacks(0, 14); // no grace at all
check('with 0-day grace, 1 day past expiry is EXPIRED', strict.derive({ ...base, status: LicenseStatus.ACTIVE, expiresAt: daysFromNow(-1) }, NOW).status === LicenseStatus.EXPIRED);

const lenient = new LicenseStatusService(stubPrisma);
lenient.setFallbacks(30, 14); // generous grace
check('with 30-day grace, 20 days past expiry is still EXPIRING', lenient.derive({ ...base, status: LicenseStatus.ACTIVE, expiresAt: daysFromNow(-20) }, NOW).status === LicenseStatus.EXPIRING);

const wideWindow = new LicenseStatusService(stubPrisma);
wideWindow.setFallbacks(7, 90); // long warning window
check('a 60-day expiry is EXPIRING when the window is 90 days', wideWindow.derive({ ...base, status: LicenseStatus.ACTIVE, expiresAt: daysFromNow(60) }, NOW).status === LicenseStatus.EXPIRING);

console.log(`\n${'='.repeat(52)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(52));
process.exit(failed > 0 ? 1 : 0);

