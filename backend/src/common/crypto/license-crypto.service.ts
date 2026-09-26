import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * License payload delivered to the customer application.
 * Only what the client needs to run — no internal IDs, no customer PII.
 */
export interface LicensePayload {
  licenseKey: string;
  planKey: string;
  edition: string;
  features: string[];
  maxDevices: number;
  issuedAt: string;
  expiresAt: string | null;
  version: number;
}

@Injectable()
export class LicenseCryptoService implements OnModuleInit {
  private readonly logger = new Logger(LicenseCryptoService.name);
  private privateKeyPem: string | null = null;
  private publicKeyPem: string | null = null;
  private algorithm: 'RSA-SHA256' | 'ed25519' = 'RSA-SHA256';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const privPath = resolve(this.config.get<string>('LICENSE_PRIVATE_KEY_PATH', 'keys/license-private.pem'));
    const pubPath = resolve(this.config.get<string>('LICENSE_PUBLIC_KEY_PATH', 'keys/license-public.pem'));

    if (!existsSync(privPath)) {
      // In development we can bootstrap a key pair so the panel is usable
      // immediately. In production this is a hard failure by design.
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new Error(
          `License private key not found at ${privPath}. Run "npm run keygen" and keep the file on the server only.`,
        );
      }
      this.logger.warn('License private key missing — generating a development-only key pair');
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      mkdirSync(dirname(privPath), { recursive: true });
      mkdirSync(dirname(pubPath), { recursive: true });
      writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 });
      writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }) as string, { mode: 0o644 });
    }

    this.privateKeyPem = readFileSync(privPath, 'utf8');
    this.publicKeyPem = existsSync(pubPath)
      ? readFileSync(pubPath, 'utf8')
      : createPublicKey(this.privateKeyPem).export({ type: 'spki', format: 'pem' }) as string;

    const keyObject = createPublicKey(this.publicKeyPem);
    this.algorithm = keyObject.asymmetricKeyType === 'ed25519' ? 'ed25519' : 'RSA-SHA256';

    this.logger.log(`License signing key loaded (${this.algorithm}) — private key stays server-side`);
  }

  /**
   * Canonical serialisation. Key order is fixed so the signature is stable and
   * the customer app can reproduce the exact bytes it verifies.
   */
  canonicalize(payload: LicensePayload): string {
    return JSON.stringify({
      licenseKey: payload.licenseKey,
      planKey: payload.planKey,
      edition: payload.edition,
      features: [...payload.features].sort(),
      maxDevices: payload.maxDevices,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      version: payload.version,
    });
  }

  /** Signs a payload. Private key never leaves the server. */
  sign(payload: LicensePayload): { signature: string; payloadHash: string; canonical: string } {
    if (!this.privateKeyPem) throw new Error('Signing key not initialised');
    const canonical = this.canonicalize(payload);
    const signature =
      this.algorithm === 'ed25519'
        ? cryptoSign(null, Buffer.from(canonical), this.privateKeyPem).toString('base64')
        : cryptoSign('sha256', Buffer.from(canonical), this.privateKeyPem).toString('base64');
    return { signature, payloadHash: this.hash(canonical), canonical };
  }

  /** Self-check used by the health endpoint. */
  verify(canonical: string, signature: string): boolean {
    try {
      if (!this.publicKeyPem) return false;
      return this.algorithm === 'ed25519'
        ? cryptoVerify(null, Buffer.from(canonical), this.publicKeyPem, Buffer.from(signature, 'base64'))
        : cryptoVerify('sha256', Buffer.from(canonical), this.publicKeyPem, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  }

  hash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Public key for distribution. Only the PUBLIC key is ever returned, and it
   * is safe to embed in the desktop application.
   */
  getPublicKeyPem(): string {
    return this.publicKeyPem ?? '';
  }

  /**
   * Decrypts a stored AES-256-GCM ciphertext (used for TOTP secrets).
   * Layout: base64( iv[12] | authTag[16] | ciphertext )
   */
  decryptSecret(ciphertextB64: string, keyHex: string): string {
    const buffer = Buffer.from(ciphertextB64, 'base64');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const data = buffer.subarray(28);
    const key = Buffer.from(keyHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** Encrypts with AES-256-GCM. Same layout as decryptSecret. */
  encryptSecret(plaintext: string, keyHex: string): string {
    const key = Buffer.from(keyHex, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
  }
}
