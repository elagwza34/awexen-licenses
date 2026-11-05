require('ts-node/register/transpile-only');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {generateKeyPairSync} = require('node:crypto');
const {LicenseCryptoService} = require('../src/common/crypto/license-crypto.service');

test('offline lease signature covers device, deadline and licence version', () => {
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const service = new LicenseCryptoService({});
  service.privateKeyPem = privateKey.export({type:'pkcs8',format:'pem'});
  service.publicKeyPem = publicKey.export({type:'spki',format:'pem'});
  const lease = {purpose:'desktop-offline-lease', licenseKey:'FIXTURE', deviceFingerprint:'DEVICE',
    validatedAt:'2026-01-01T00:00:00Z', nextCheckAt:'2026-01-04T00:00:00Z',
    offlineUntil:'2026-01-11T00:00:00Z', version:3};
  const signed = service.signDocument(lease);
  assert.equal(service.verify(signed.document, signed.signature), true);
  for(const field of ['deviceFingerprint','offlineUntil','version']) {
    assert.equal(service.verify(JSON.stringify({...lease,[field]:'CHANGED'}),signed.signature), false);
  }
});
