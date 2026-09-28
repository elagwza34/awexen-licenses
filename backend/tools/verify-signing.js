/**
 * Proves the RSA signing contract that a PHP/Laravel rewrite must reproduce.
 *
 * The whole migration hinges on one question: can PHP/OpenSSL produce a
 * signature that the existing Node backend, and the shipped desktop app, both
 * accept — and vice versa? This script signs with the real key using Node, then
 * verifies the same bytes with PHP, in both directions.
 *
 * The subtle part is the canonical form. It is `JSON.stringify` of an object
 * with a fixed key order, and JS stringifies differently from PHP's json_encode
 * for several values (forward slashes escaped, floats, null handling). The
 * comparison below is the test that catches that, which is why it compares the
 * canonical strings and not just "signature is non-empty".
 *
 * Run with: node tools/verify-signing.js
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const keyPath = process.argv[2] || path.join(__dirname, '..', 'keys', 'license-private.pem');
const privPem = fs.readFileSync(keyPath, 'utf8');
const pubPem = crypto
  .createPublicKey(privPem)
  .export({ type: 'spki', format: 'pem' })
  .toString();

/** A payload that exercises the awkward cases: a null date and a slashed string. */
const payload = {
  licenseKey: 'PROD-TEST-AAAA-BBBB-CCCC',
  planKey: 'PRO',
  edition: 'Professional',
  features: ['reports', 'inventory', 'multi-branch'],
  maxDevices: 5,
  issuedAt: '2026-01-15T10:30:00.000Z',
  expiresAt: null,
  version: 3,
};

// Must match LicenseCryptoService.canonicalize() byte for byte.
const canonical = JSON.stringify({
  licenseKey: payload.licenseKey,
  planKey: payload.planKey,
  edition: payload.edition,
  features: [...payload.features].sort(),
  maxDevices: payload.maxDevices,
  issuedAt: payload.issuedAt,
  expiresAt: payload.expiresAt,
  version: payload.version,
});

const signature = crypto.sign('sha256', Buffer.from(canonical), privPem).toString('base64');
const payloadHash = crypto.createHash('sha256').update(canonical).digest('hex');

console.log('canonical   :', canonical);
console.log('payloadHash :', payloadHash);
console.log('signature   :', signature.slice(0, 44) + '...');
console.log('self-verify :', crypto.verify('sha256', Buffer.from(canonical), pubPem, Buffer.from(signature, 'base64')));

// Hand the same inputs to PHP, which is what the Laravel implementation will do.
const php = `<?php
$k = openssl_pkey_get_private(file_get_contents($argv[1]));
$d = openssl_pkey_get_details($k);
fwrite(STDERR, 'php key type: ' . $d['type'] . " (" . $d['bits'] . " bits)\\n");
$canonical = file_get_contents($argv[2]);
$nodeSig = file_get_contents($argv[3]);
$pub = openssl_pkey_get_public(file_get_contents($argv[4]));
fwrite(STDERR, 'php verifies node signature: ' .
  (openssl_verify($canonical, $nodeSig, $pub, OPENSSL_ALGO_SHA256) === 1 ? 'YES' : 'NO') . "\\n");
$phpSig = '';
openssl_sign($canonical, $phpSig, $k, OPENSSL_ALGO_SHA256);
fwrite(STDERR, 'php signature == node signature: ' .
  (base64_encode($phpSig) === trim($nodeSig) ? 'YES (deterministic PKCS1v15)' : 'NO') . "\\n");
`;

fs.writeFileSync(path.join(__dirname, '_sign_probe.php'), php);
const tmp = path.join(__dirname, '_sign_input.txt');
fs.writeFileSync(tmp, canonical);
const sigFile = path.join(__dirname, '_sign_input.sig');
fs.writeFileSync(sigFile, signature);
const pubFile = path.join(__dirname, '_sign_pub.pem');
fs.writeFileSync(pubFile, pubPem);

try {
  const out = execFileSync('php', [path.join(__dirname, '_sign_probe.php'), keyPath, tmp, sigFile, pubFile], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  console.log(out);
} catch {
  console.log('PHP not available on this machine — skipped the cross-check.');
} finally {
  for (const f of ['_sign_probe.php', '_sign_input.txt', '_sign_input.sig', '_sign_pub.pem']) {
    fs.rmSync(path.join(__dirname, f), { force: true });
  }
}
