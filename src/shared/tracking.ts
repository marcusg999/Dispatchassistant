/**
 * Tracking codes: WORD-WORD-WORD-WORD-1234.
 *
 *  - 4 words from a ~1,959-word list (≈10.94 bits each) + 4 digits (≈13.29 bits)
 *    ⇒ ≈57 bits of entropy from crypto.getRandomValues, with rejection sampling so
 *    there is no modulo bias.
 *  - Only SHA-256(normalized code) ever leaves the device. The plain code is never
 *    sent or stored.
 */
import { WORDS } from './wordlist';

const WORD_COUNT = 4;
const DIGITS = 4;

/** Uniform integer in [0, max) using rejection sampling over 32-bit values. */
function randomBelow(max: number, rng: (a: Uint32Array) => Uint32Array): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    rng(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

const defaultRng = (a: Uint32Array) => crypto.getRandomValues(a);

export function generateTrackingCode(rng: (a: Uint32Array) => Uint32Array = defaultRng): string {
  const words = Array.from({ length: WORD_COUNT }, () => WORDS[randomBelow(WORDS.length, rng)].toUpperCase());
  const digits = String(randomBelow(10 ** DIGITS, rng)).padStart(DIGITS, '0');
  return [...words, digits].join('-');
}

/** Entropy in bits of a freshly generated code. */
export const TRACKING_CODE_BITS = WORD_COUNT * Math.log2(WORDS.length) + DIGITS * Math.log2(10);

/** Accepts sloppy typing: lowercase, spaces, missing or extra dashes. */
export function normalizeTrackingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function looksLikeTrackingCode(input: string): boolean {
  return /^([A-Z]{3,8}-){4}\d{4}$/.test(normalizeTrackingCode(input));
}

export async function hashTrackingCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeTrackingCode(code));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
