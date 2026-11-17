// Optional, encrypted deployment recovery. No customer images belong in Git.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function restoreReleaseReceipts(snapshotPath, directory, privateKey) {
  if (!fs.existsSync(snapshotPath)) return 0;
  if (fs.statSync(snapshotPath).size > 128 * 1024 * 1024) throw new Error('Receipt snapshot exceeds recovery limit');
  const envelope = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  if (envelope.version !== 1) throw new Error('Unsupported receipt snapshot');
  const key = crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(envelope.key, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const payload = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  key.fill(0);
  const files = JSON.parse(payload.toString('utf8'));
  if (!Array.isArray(files) || files.length > 10000) throw new Error('Invalid receipt snapshot');
  const seen = new Set();
  const prepared = files.map(file => {
    if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(file.name) || seen.has(file.name)) throw new Error('Invalid receipt filename');
    seen.add(file.name);
    const data = Buffer.from(file.data, 'base64');
    if (crypto.createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error('Receipt checksum mismatch');
    const target = path.join(directory, file.name);
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink() || !fs.readFileSync(target).equals(data)) throw new Error('Receipt recovery conflict');
      return null;
    }
    return { target, data };
  }).filter(Boolean);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const file of prepared) fs.writeFileSync(file.target, file.data, { flag: 'wx', mode: 0o600 });
  fs.unlinkSync(snapshotPath);
  return prepared.length;
}

module.exports = { restoreReleaseReceipts };
