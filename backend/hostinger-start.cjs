// Hostinger starts Node directly, so reproduce the Docker key initialization.
// Keys arrive through protected environment variables and never ship in source.
const { createPrivateKey } = require('node:crypto');
const { mkdirSync, renameSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

process.chdir(__dirname);
const encoded = process.env.LICENSE_PRIVATE_KEY_PEM_B64;
const raw = process.env.LICENSE_PRIVATE_KEY_PEM;
if (!encoded && !raw) {
  throw new Error('The existing production signing key must be configured before startup.');
}
const pem = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : raw;
// Validate before touching the active key file. Never generate a replacement.
createPrivateKey(pem);
const keyPath = resolve(process.env.LICENSE_PRIVATE_KEY_PATH || 'keys/license-private.pem');
mkdirSync(dirname(keyPath), { recursive: true });
const temporaryPath = `${keyPath}.tmp`;
writeFileSync(temporaryPath, pem, { mode: 0o600 });
renameSync(temporaryPath, keyPath);
require('./dist/main.js');
