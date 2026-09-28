/**
 * Proves the RSA signing contract that a PHP/Laravel rewrite must reproduce.
 *
 * The whole migration hinges on one question: can PHP/OpenSSL produce a
 * signature that the existing Node backend, and the shipped desktop app, both
 * accept â€” and vice versa? This script signs with the real key using Node, then
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
const os = require('os');
const { execFileSync } = require('child_process');

const keyPath = process.argv[2] || path.join(__dirname, '..', 'keys', 'license-private.pem');
const privPem = fs.readFileSync(keyPath, 'utf8');
const pubPem = crypto
  .createPublicKey(privPem)
  .export({ type: 'spki', format: 'pem' })
  .toString();

/** Locates a PHP binary: explicit arg, PATH, then common Windows installs. */
function findPhp() {
  const explicit = process.argv[3];
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    'php',
    'C:\\xampp\\php\\php.exe',
    'C:\\php\\php.exe',
    'C:\\laragon\\bin\\php\\php-8.3.0\\php.exe',
    '/usr/bin/php',
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['-v'], { stdio: 'ignore' });
      return c;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const key = crypto.createPublicKey(pubPem);
const details = key.asymmetricKeyDetails || {};
console.log(
  'key        : %s, %d-bit, e=%s',
  key.asymmetricKeyType,
  details.modulusLength,
  details.publicExponent,
);

/**
 * A payload that exercises the awkward cases: a null date and a slashed string.
 *
 * The slash cases are the point of this script. `json_encode('acme/corp')` emits
 * `"acme\/corp"` while `JSON.stringify` emits `"acme/corp"`, so a Laravel port
 * that forgets JSON_UNESCAPED_SLASHES signs different bytes and every licence
 * containing a slash fails verification in the shipped desktop app. A fixture
 * set without a slash would never reveal it.
 */
const payload = {
  licenseKey: 'PROD-TEST-AAAA-BBBB-CCCC',
  planKey: 'PRO',
  edition: 'Home/Office',
  features: ['reports', 'inventory', 'multi/branch'],
  maxDevices: 5,
  issuedAt: '2026-01-15T10:30:00.000Z',
  expiresAt: null,
  version: 3,
};


/**
 * Each case is signed by Node, then PHP must reproduce the canonical string
 * byte-for-byte AND verify the signature. Byte equality is checked first on
 * purpose: a canonical mismatch is the real defect, and comparing signatures
 * alone would misdiagnose it as a key problem.
 */
const CASES = [
  { name: 'simple ascii (no slash)', edition: 'Professional', planKey: 'PRO', features: ['inventory', 'reports'] },
  { name: 'slash in edition  <-- the trap', edition: 'Home/Office', planKey: 'PRO', features: ['inventory'] },
  { name: 'slash in planKey', edition: 'Professional', planKey: 'PRO/PLUS', features: ['inventory'] },
  { name: 'slash in a feature key', edition: 'Professional', planKey: 'PRO', features: ['multi/branch', 'reports'] },
  { name: 'backslash, quotes, newline', edition: 'Say "hi"\nnow', planKey: 'A\\B', features: ['a"b', 'c\\d'] },
  { name: 'arabic unicode', edition: 'Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ù…ØªÙ‚Ø¯Ù…Ø©', planKey: 'Ù…Ø­ØªØ±Ù', features: ['Ø§Ù„Ù…Ø®Ø²ÙˆÙ†', 'Ø§Ù„ØªÙ‚Ø§Ø±ÙŠØ±'] },
  { name: 'slash AND arabic together', edition: 'Ø§Ø­ØªØ±Ø§ÙÙŠØ©/Ù…ØªÙ‚Ø¯Ù…Ø©', planKey: 'Ù…/Ø±', features: ['Ù…Ø®Ø²ÙˆÙ†/ØªÙ‚Ø§Ø±ÙŠØ±'] },
  { name: 'empty + zero + null expiry', edition: '', planKey: '', features: [], maxDevices: 0, version: 0 },
];

const records = CASES.map((c) => {
  const p = {
    licenseKey: 'PROD-TEST-AAAA-BBBB-CCCC',
    planKey: c.planKey,
    edition: c.edition,
    features: c.features,
    maxDevices: c.maxDevices ?? 5,
    issuedAt: '2026-01-15T10:30:00.000Z',
    expiresAt: null,
    version: c.version ?? 3,
  };
  // Must match LicenseCryptoService.canonicalize() byte for byte.
  const canonical = JSON.stringify({
    licenseKey: p.licenseKey,
    planKey: p.planKey,
    edition: p.edition,
    features: [...p.features].sort(),
    maxDevices: p.maxDevices,
    issuedAt: p.issuedAt,
    expiresAt: p.expiresAt,
    version: p.version,
  });
  const signature = crypto.sign('sha256', Buffer.from(canonical, 'utf8'), privPem).toString('base64');
  return {
    name: c.name,
    canonical,
    signature,
    selfOk: crypto.verify('sha256', Buffer.from(canonical, 'utf8'), pubPem, Buffer.from(signature, 'base64')),
    slashed: canonical.includes('/'),
  };
});

for (const r of records) {
  console.log('[%s] %s%s', r.selfOk ? 'node ok' : 'NODE FAIL', r.name, r.slashed ? '  (contains /)' : '');
}

const php = findPhp();
if (!php) {
  console.log('\nPHP not found on this machine - the cross-language check did NOT run.');
  console.log('Install PHP 8.3+ (with openssl) or pass its path as argv[3].');
  process.exit(2);
}
console.log('\n--- PHP cross-check (openssl, JSON_UNESCAPED_SLASHES) ---');

// Temp files live in %TEMP%: the tools directory is inside the git repo, and
// writing scratch files there risks committing a private key or a signature.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'signprobe-'));
const phpScript = path.join(work, 'probe.php');
const dataFile = path.join(work, 'cases.json');

fs.writeFileSync(dataFile, JSON.stringify({ publicKey: pubPem, records }));
fs.writeFileSync(
  phpScript,
  `<?php
$in = json_decode(file_get_contents($argv[1]), true);
$pub = openssl_pkey_get_public($in['publicKey']);
if ($pub === false) { fwrite(STDERR, "public key unreadable\\n"); exit(1); }
$out = [];
foreach ($in['records'] as $r) {
  // This is the line a Laravel implementation must match.
  $ours = json_encode(json_decode($r['canonical'], true), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  $bytesMatch = ($ours === $r['canonical']);
  $verify = openssl_verify($r['canonical'], base64_decode($r['signature']), $pub, OPENSSL_ALGO_SHA256) === 1;
  $out[] = ['name' => $r['name'], 'bytesMatch' => $bytesMatch, 'verify' => $verify,
            'ours' => $bytesMatch ? null : $ours, 'node' => $r['canonical']];
}
echo json_encode($out, JSON_UNESCAPED_SLASHES);
`,
);

let bad = 0;
try {
  const res = execFileSync(php, [phpScript, dataFile], { encoding: 'utf8' });
  for (const r of JSON.parse(res)) {
    const good = r.bytesMatch && r.verify;
    if (!good) bad += 1;
    console.log('[%s] %s', good ? 'MATCH    ' : 'MISMATCH ', r.name);
    if (!r.bytesMatch) console.log('   node: %s\n   php : %s', r.node, r.ours);
    if (!r.verify) console.log('   openssl_verify REJECTED the signature');
  }
} catch (err) {
  console.log('PHP probe failed to run:', err.message);
  bad = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(64));
if (bad === 0) {
  console.log('  Node and PHP agree on all %d case(s), including every one with a slash.', records.length);
  console.log('  A Laravel canonicaliser using JSON_UNESCAPED_SLASHES is byte-compatible.');
} else {
  console.log('  %d case(s) MISMATCH - do not migrate signing until resolved.', bad);
}
console.log('='.repeat(64));
process.exit(bad === 0 ? 0 : 1);
