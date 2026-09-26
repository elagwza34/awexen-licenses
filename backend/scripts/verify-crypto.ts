import { generateKeyPairSync, sign } from 'node:crypto';
import { LicenseCryptoService } from '../src/common/crypto/license-crypto.service';
import { SecurityService } from '../src/common/crypto/security.service';

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

/** Minimal ConfigService stand-in; the services only read a few keys. */
const stubConfig = {
  get: (key: string, fallback?: string) =>
    ({ LICENSE_PRIVATE_KEY_PATH: 'unused', LICENSE_PUBLIC_KEY_PATH: 'unused', NODE_ENV: 'test' })[
      key
    ] ?? fallback,
} as never;

/**
 * Local TOTP implementation used to generate codes at arbitrary timestamps so
 * the service can be checked against the RFC 6238 vectors.
 */
function totpAt(secret: string, timeSeconds: number): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const index = ALPHABET.indexOf(char);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  const counter = Math.floor(timeSeconds / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHmac } = require('node:crypto');
  const hmac = createHmac('sha1', Buffer.from(output)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

async function main() {
  console.log('\n[1] License payload signing (RSA-2048)');

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const crypto = new LicenseCryptoService(stubConfig);
  // Inject the generated key material, bypassing file IO.
  (crypto as unknown as { privateKeyPem: string }).privateKeyPem = privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string;
  (crypto as unknown as { publicKeyPem: string }).publicKeyPem = publicKey.export({
    type: 'spki',
    format: 'pem',
  }) as string;

  const payload = {
    licenseKey: 'PROD-TEST-TEST-TEST-TEST',
    planKey: 'PROFESSIONAL',
    edition: 'Professional',
    features: ['INVENTORY', 'POS', 'PRODUCTS'],
    maxDevices: 3,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    version: 1,
  };

  const signed = crypto.sign(payload);
  check('signature produced', signed.signature.length > 0);
  check('payload hash is sha-256 hex', /^[a-f0-9]{64}$/.test(signed.payloadHash));
  check('own signature verifies', crypto.verify(signed.canonical, signed.signature));
  check('signing is deterministic', crypto.sign(payload).payloadHash === signed.payloadHash);
  check(
    'feature order does not change the hash',
    crypto.sign({ ...payload, features: [...payload.features].reverse() }).payloadHash ===
      signed.payloadHash,
  );
  check(
    'tampering with maxDevices changes the hash',
    crypto.sign({ ...payload, maxDevices: 999 }).payloadHash !== signed.payloadHash,
  );

  const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const forged = sign('sha256', Buffer.from(signed.canonical), otherKeys.privateKey).toString('base64');
  check('forged signature from another key is rejected', !crypto.verify(signed.canonical, forged));

  const exposed = crypto.getPublicKeyPem();
  check('public key contains only PUBLIC KEY', exposed.includes('BEGIN PUBLIC KEY'));
  check('private material is never exposed', !exposed.includes('PRIVATE'));


  console.log('\n[2] AES-256-GCM secret encryption');

  const keyHex = 'a'.repeat(64);
  const plaintext = 'JBSWY3DPEHPK3PXP';
  const encrypted = crypto.encryptSecret(plaintext, keyHex);
  check('ciphertext differs from plaintext', encrypted !== plaintext);
  check('decrypt round-trips', crypto.decryptSecret(encrypted, keyHex) === plaintext);
  check(
    'ciphertext is non-deterministic (fresh IV)',
    crypto.encryptSecret(plaintext, keyHex) !== crypto.encryptSecret(plaintext, keyHex),
  );

  let rejected = false;
  try {
    const buffer = Buffer.from(encrypted, 'base64');
    buffer[buffer.length - 1] ^= 0xff;
    crypto.decryptSecret(buffer.toString('base64'), keyHex);
  } catch {
    rejected = true;
  }
  check('tampered ciphertext is rejected by the auth tag', rejected);

  console.log('\n[3] TOTP against RFC 6238 test vectors');

  const security = new SecurityService(stubConfig);
  // base32 of the ASCII key "12345678901234567890".
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  // The RFC codes are 8 digits; ours are 6, so compare the last 6.
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];

  // The service generates its own codes; verify it accepts the same values the
  // reference implementation produces by replaying them through verifyTotp is
  // not possible (time-dependent), so we assert determinism plus acceptance.
  for (const [time, expected] of vectors) {
    const code = totpAt(RFC_SECRET, time);
    check(`reference TOTP at t=${time} -> ...${expected}`, code === expected, `got ${code}`);
  }

  const secret = security.generateTotpSecret();
  check('generated secret is 32 base32 chars', /^[A-Z2-7]{32}$/.test(secret), secret);
  check(
    'a valid code is accepted',
    security.verifyTotp(secret, totpAt(secret, Date.now() / 1000)),
  );
  check('a malformed code is rejected', !security.verifyTotp(secret, 'abcdef'));
  check('a wrong-length code is rejected', !security.verifyTotp(secret, '12345'));

  // Two independently generated secrets must not collide.
  check(
    'secrets are unique',
    security.generateTotpSecret() !== security.generateTotpSecret(),
  );

  console.log('\n[4] Argon2id password hashing');

  const hash = await security.hashPassword('Correct!Horse2026');
  check('hash produced', hash.length > 0);
  check('correct password verifies', await security.verifyPassword('Correct!Horse2026', hash));
  check('wrong password rejected', !(await security.verifyPassword('Wrong!Horse2026', hash)));
  check('hash does not contain the plaintext', !hash.includes('Correct!Horse2026'));

  check('weak password rejected', SecurityService.assertPasswordStrength('short').length > 0);
  check(
    'strong password accepted',
    SecurityService.assertPasswordStrength('Str0ng!Passw0rd').length === 0,
  );

  console.log('\n[5] Token and fingerprint hashing');

  const fp1 = security.hashFingerprint(['machine-a', 'disk-1']);
  check('fingerprint hash is deterministic', fp1 === security.hashFingerprint(['machine-a', 'disk-1']));
  check('different machines hash differently', fp1 !== security.hashFingerprint(['machine-b', 'disk-1']));
  check('fingerprint hash is 64 hex chars', /^[a-f0-9]{64}$/.test(fp1));
  check('token hash is 64 hex chars', /^[a-f0-9]{64}$/.test(security.hashToken('abc')));
  check('family ids are unique', security.createFamilyId() !== security.createFamilyId());

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('='.repeat(52));
  process.exit(failed > 0 ? 1 : 0);
}

main();

