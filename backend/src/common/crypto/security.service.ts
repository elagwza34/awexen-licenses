import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — OWASP baseline
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class SecurityService {
  constructor(private readonly config: ConfigService) {}

  private get pepper(): string {
    return this.config.get<string>('PASSWORD_PEPPER', '');
  }

  /** Argon2id hash, then peppered so a stolen DB still needs the app secret. */
  async hashPassword(plain: string): Promise<string> {
    const salted = this.pepperPassword(plain);
    return argon2.hash(salted, ARGON2_OPTIONS);
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    try {
      // Signature is verify(digest, plain) — the hash comes first.
      return await argon2.verify(hash, this.pepperPassword(plain));
    } catch {
      // A malformed or truncated hash must fail closed, not throw.
      return false;
    }
  }

  private pepperPassword(plain: string): string {
    return this.pepper ? `${plain}::${this.pepper}` : plain;
  }

  /**
   * Strong password policy. Deliberately strict: this panel controls every
   * customer's licence.
   */
  static assertPasswordStrength(password: string): string[] {
    const problems: string[] = [];
    if (password.length < 12) problems.push('Password must be at least 12 characters');
    if (!/[a-z]/.test(password)) problems.push('Password must contain a lowercase letter');
    if (!/[A-Z]/.test(password)) problems.push('Password must contain an uppercase letter');
    if (!/\d/.test(password)) problems.push('Password must contain a number');
    if (!/[^\w\s]/.test(password)) problems.push('Password must contain a symbol');
    return problems;
  }

  // ---- Token helpers ----

  createOpaqueToken(bytes = 48): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Refresh tokens are stored as SHA-256 hashes only. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  createFamilyId(): string {
    return randomUUID();
  }

  /**
   * Device fingerprints are hashed with a server-side secret so a fingerprint
   * cannot be reverse-engineered or forged into a known value.
   */
  hashFingerprint(parts: string[]): string {
    return createHash('sha256')
      .update(`${parts.join('|')}::${this.pepper}`)
      .digest('hex');
  }

  /** Derives the 32-byte key used to encrypt TOTP secrets at rest. */
  getEncryptionKey(): Buffer {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET', '');
    return createHash('sha256').update(`${secret}::2fa`).digest();
  }

  randomIdempotencyKey(): string {
    return randomUUID();
  }

  // ---- 2FA (TOTP) ----

  /**
   * Generates a 160-bit TOTP secret, properly base32-encoded to 32
   * characters. Naively mapping each byte to one character would emit only
   * 20 characters (100 bits) and not round-trip, which some authenticator
   * apps handle badly.
   */
  generateTotpSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /** RFC 6238 TOTP, 30s step, 6 digits, ±1 window. */
  verifyTotp(secret: string, token: string): boolean {
    const normalized = token.replace(/\s/g, '');
    if (!/^\d{6}$/.test(normalized)) return false;
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let offset = -1; offset <= 1; offset += 1) {
      if (this.totpAt(secret, counter + offset) === normalized) return true;
    }
    return false;
  }

  private totpAt(secret: string, counter: number): string {
    // base32 alphabet, unpadded — matches Google Authenticator / Authy.
    const decoded = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    // RFC 4226 requires HMAC-SHA1, not a bare hash.
    const hmac = createHmac('sha1', decoded).update(buf).digest();
    const index = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[index] & 0x7f) << 24) |
      ((hmac[index + 1] & 0xff) << 16) |
      ((hmac[index + 2] & 0xff) << 8) |
      (hmac[index + 3] & 0xff);
    return String(code % 1_000_000).padStart(6, '0');
  }
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encodes bytes as unpadded base32 (RFC 4648), the format authenticator apps expect. */
function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // Flush the remaining bits, right-padded with zeros.
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
