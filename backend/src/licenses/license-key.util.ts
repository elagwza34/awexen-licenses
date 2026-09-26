import { randomBytes } from 'node:crypto';

/**
 * Generates human-transcribable license keys.
 *
 * Format: PREFIX-XXXX-XXXX-XXXX-XXXX
 * Alphabet excludes I, O, 0, 1 so a customer reading a key over the phone
 * cannot mistype it. Entropy comes from rejection sampling, so every character
 * is uniformly distributed.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomChunk(length: number): string {
  let out = '';
  // Rejection sampling avoids the modulo bias of the naive approach.
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  while (out.length < length) {
    const bytes = randomBytes(length);
    for (const byte of bytes) {
      if (byte >= max) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function generateLicenseKey(prefix: string, groups = 4, groupLength = 4): string {
  const parts = Array.from({ length: groups }, () => randomChunk(groupLength));
  return [prefix, ...parts].join('-').toUpperCase();
}

/** Normalises user input: "prod 7f3a92kd" -> "PROD-7F3A-92KD". */
export function normalizeLicenseKey(input: string): string {
  return input.trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

export function maskLicenseKey(key: string): string {
  const parts = key.split('-');
  if (parts.length < 2) return `${key.slice(0, 3)}****`;
  return [parts[0], ...parts.slice(1).map((p) => `${p.slice(0, 2)}${'*'.repeat(Math.max(p.length - 2, 2))}`)].join('-');
}
