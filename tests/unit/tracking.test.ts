import { describe, expect, it } from 'vitest';
import {
  TRACKING_CODE_BITS,
  generateTrackingCode,
  hashTrackingCode,
  looksLikeTrackingCode,
  normalizeTrackingCode,
} from '../../src/shared/tracking';
import { WORDS } from '../../src/shared/wordlist';

describe('tracking codes', () => {
  it('has at least 50 bits of entropy', () => {
    expect(TRACKING_CODE_BITS).toBeGreaterThanOrEqual(50);
    expect(new Set(WORDS).size).toBe(WORDS.length); // no duplicate words (would reduce entropy)
  });

  it('looks like WORD-WORD-WORD-WORD-1234', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateTrackingCode();
      expect(code).toMatch(/^([A-Z]{3,8}-){4}\d{4}$/);
      expect(looksLikeTrackingCode(code)).toBe(true);
    }
  });

  it('uses crypto.getRandomValues (injectable RNG) and is uniform enough', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateTrackingCode());
    expect(seen.size).toBe(2000);
    let calls = 0;
    const code = generateTrackingCode((a) => {
      calls++;
      a[0] = 0;
      return a;
    });
    expect(calls).toBe(5);
    expect(code).toBe(`${WORDS[0].toUpperCase()}-${WORDS[0].toUpperCase()}-${WORDS[0].toUpperCase()}-${WORDS[0].toUpperCase()}-0000`);
  });

  it('rejection-samples values that would cause modulo bias', () => {
    const limit = Math.floor(0x1_0000_0000 / WORDS.length) * WORDS.length;
    const values = [0xffffffff, 3, 0xffffffff, 3, 3, 3, 0xfffffff0, 7];
    let i = 0;
    const code = generateTrackingCode((a) => {
      a[0] = values[i++];
      return a;
    });
    expect(0xffffffff >= limit).toBe(true);
    expect(code.startsWith(WORDS[3].toUpperCase())).toBe(true);
    expect(i).toBe(values.length);
  });

  it('normalizes sloppy input', () => {
    expect(normalizeTrackingCode('  cedar harbor  maple--stone 7342 ')).toBe('CEDAR-HARBOR-MAPLE-STONE-7342');
    expect(looksLikeTrackingCode('cedar harbor maple stone 7342')).toBe(true);
    expect(looksLikeTrackingCode('CEDAR-HARBOR-7342')).toBe(false);
  });

  it('hashes the normalized code with SHA-256 (hex)', async () => {
    const h = await hashTrackingCode('brave canyon orbit maple 1001');
    expect(h).toBe(await hashTrackingCode('BRAVE-CANYON-ORBIT-MAPLE-1001'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Known vector: sha256("BRAVE-CANYON-ORBIT-MAPLE-1001")
    const { createHash } = await import('node:crypto');
    expect(h).toBe(createHash('sha256').update('BRAVE-CANYON-ORBIT-MAPLE-1001').digest('hex'));
  });
});
