/**
 * Proves the seeded SUPER_ADMIN can actually sign in.
 *
 * The seed stores hash(password + "::" + pepper). If the pepper used to seed
 * is not the pepper the application will run with, the account is created,
 * reports success, and can never authenticate. Nothing else in the system
 * catches that: the row exists, the role is assigned, the audit trail is clean.
 * This check is the only thing that does.
 *
 * Run after seeding, before deploying:
 *   npm run verify:seed-credentials
 *
 * Reads the pepper and password from the environment (set-fly-secrets.ps1
 * uploads the very same values to Fly) and the database from DATABASE_URL.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log('Verifying the seeded owner credentials\n');

  const email = (process.env.SEED_ADMIN_EMAIL ?? '').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  const pepper = process.env.PASSWORD_PEPPER ?? '';

  check('SEED_ADMIN_EMAIL is set', Boolean(email));
  check('SEED_ADMIN_PASSWORD is set', password.length >= 12, `length ${password.length}`);
  check('PASSWORD_PEPPER is set', pepper.length >= 16, `length ${pepper.length}`);

  if (!email || !password || !pepper) {
    console.log('\nCannot continue without the credentials.');
    process.exit(1);
  }

  const admin = await prisma.admin.findUnique({ where: { email } });
  check('the admin row exists in the database', Boolean(admin), `looked for ${email}`);

  if (!admin) {
    console.log('\nThe seed did not create the owner. Check SEED_ADMIN_PASSWORD was set.');
    process.exit(1);
  }

  const salted = `${password}::${pepper}`;
  const ok = await argon2.verify(admin.passwordHash, salted);
  check('the stored hash matches password + THIS pepper', ok);
  check(
    'the wrong pepper is rejected',
    !(await argon2.verify(admin.passwordHash, `${password}::some-other-pepper`)),
  );

  const role = await prisma.adminRole.findFirst({
    where: { adminId: admin.id, role: { key: 'SUPER_ADMIN' } },
  });
  check('the SUPER_ADMIN role is assigned', Boolean(role));
  check('the account is ACTIVE', admin.status === 'ACTIVE', `status ${admin.status}`);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('='.repeat(52));

  if (failed) {
    console.log('\nDo NOT deploy: the owner would be unable to sign in.');
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error('Verification could not run:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
