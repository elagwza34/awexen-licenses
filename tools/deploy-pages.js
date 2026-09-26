/**
 * Uploads the built panel to a Cloudflare Pages project.
 *
 * Cloudflare's deployment endpoint wants a multipart body with the zip in a
 * part named "manifest". PowerShell 5.1 has no -Form and hand-rolling the
 * multipart body there is error-prone, and Windows' ZipFile writes entry names
 * with backslashes, which Cloudflare rejects. Both problems are handled here:
 * the archive is written with forward slashes and the body is assembled byte
 * by byte so nothing is re-encoded.
 *
 * The token is read from the environment and never written to disk.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIST = path.resolve(__dirname, '..', 'frontend', 'dist');
const PROJECT = process.env.PAGES_PROJECT || 'owner-admin';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const BRANCH = process.env.PAGES_BRANCH || 'main';

/** Walk the dist directory and return [absolutePath, zipPath] pairs. */
function collect(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, base, out);
    else out.push([full, path.relative(base, full).split(path.sep).join('/')]);
  }
  return out;
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c;
    }
  }
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/**
 * Minimal zip writer, written by hand because the .NET and PowerShell
 * alternatives both emit backslash separators, and Cloudflare treats
 * "assets\index.js" as one flat filename rather than a path.
 */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [abs, zipPath] of files) {
    const nameBuf = Buffer.from(zipPath, 'utf8');
    const raw = fs.readFileSync(abs);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    // Store uncompressed when deflate does not help, per the zip spec.
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // fixed timestamp, keeps builds reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

async function main() {
  if (!ACCOUNT) throw new Error('CLOUDFLARE_ACCOUNT_ID is not set');
  if (!TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  if (!fs.existsSync(DIST)) throw new Error(`No build found at ${DIST}`);

  // _headers and _redirects carry the security headers and the SPA fallback.
  // Losing them turns every deep link into a 404 and drops the CSP, so refuse
  // to deploy a build that is missing them.
  for (const required of ['_headers', '_redirects']) {
    if (!fs.existsSync(path.join(DIST, required))) {
      throw new Error(`${required} is missing from the build; the SPA and the security headers would break`);
    }
  }

  const files = collect(DIST);
  const zip = buildZip(files);
  console.log(`Packing ${files.length} files, ${zip.length} bytes`);

  const boundary = `----PagesDeploy${Date.now().toString(16)}`;
  const head =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="branch"\r\n\r\n' +
    `${BRANCH}\r\n` +
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="manifest"; filename="pages.zip"\r\n' +
    'Content-Type: application/zip\r\n\r\n';
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), zip, Buffer.from(tail, 'utf8')]);

  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}/deployments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const json = await res.json();
  if (!json.success) {
    const errs = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`Cloudflare rejected the deployment (${res.status}) - ${errs}`);
  }

  console.log('Deployment accepted');
  console.log(`  id  : ${json.result.id}`);
  console.log(`  url : ${json.result.url}`);
  console.log(`  env : ${json.result.environment}`);
}

main().catch((e) => {
  console.error('Deployment failed:', e.message);
  process.exit(1);
});
