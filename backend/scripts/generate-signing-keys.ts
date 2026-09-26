/**
 * Generates the asymmetric key pair used to sign license payloads.
 *
 *   npm run keygen
 *
 * The PRIVATE key stays on the server and must never be committed, copied to
 * the frontend, or shipped inside the customer application. Only the public
 * key is distributed (it is embedded in the desktop app for verification).
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PRIVATE_PATH = resolve(process.env.LICENSE_PRIVATE_KEY_PATH ?? 'keys/license-private.pem');
const PUBLIC_PATH = resolve(process.env.LICENSE_PUBLIC_KEY_PATH ?? 'keys/license-public.pem');
const FORCE = process.argv.includes('--force');

if (existsSync(PRIVATE_PATH) && !FORCE) {
  console.error(`A private key already exists at ${PRIVATE_PATH}`);
  console.error('Refusing to overwrite it. Losing a key means existing licenses can no longer be re-signed.');
  console.error('Use --force only if you fully understand the consequences.');
  process.exit(1);
}

const algorithm = process.env.LICENSE_KEY_ALGORITHM === 'ed25519' ? 'ed25519' : 'rsa';

// generateKeyPairSync has distinct overloads per algorithm, so branch on the
// literal rather than passing a union (which matches no overload).
const keyPair =
  algorithm === 'ed25519'
    ? generateKeyPairSync('ed25519')
    : generateKeyPairSync('rsa', { modulusLength: 3072 });

const { privateKey, publicKey } = keyPair;

mkdirSync(dirname(PRIVATE_PATH), { recursive: true });
mkdirSync(dirname(PUBLIC_PATH), { recursive: true });

writeFileSync(
  PRIVATE_PATH,
  privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  { mode: 0o600 },
);
writeFileSync(PUBLIC_PATH, publicKey.export({ type: 'spki', format: 'pem' }) as string, { mode: 0o644 });

console.log(`Algorithm:  ${algorithm.toUpperCase()}`);
console.log(`Private:    ${PRIVATE_PATH}  (mode 600 — keep this off git and off shared storage)`);
console.log(`Public:     ${PUBLIC_PATH}  (safe to distribute)`);
console.log('');
console.log('Next steps:');
console.log('  1. Back up the private key somewhere the app server can read, and nowhere else.');
console.log('  2. Set LICENSE_PRIVATE_KEY_PATH / LICENSE_PUBLIC_KEY_PATH in your environment.');
console.log('  3. Restart the API and check GET /api/v1/health reports signingKeyLoaded: true.');
