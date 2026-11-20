import { describe, expect, it } from 'vitest';
import { storedToText, textToStored } from '../../src/admin/estimates/rates/scaled';

describe('rate card field conversion (exact cents / basis points)', () => {
  it('parses dollars to integer cents without float drift', () => {
    expect(textToStored('95', 'cents')).toBe(9500);
    expect(textToStored('0.29', 'cents')).toBe(29);
    expect(textToStored('1,234.56', 'cents') ?? textToStored('1234.56', 'cents')).toBe(123456);
    expect(textToStored('19.99', 'cents')).toBe(1999);
    expect(textToStored('0.1', 'cents')).toBe(10);
  });
  it('parses percent to basis points and multipliers', () => {
    expect(textToStored('8', 'pct')).toBe(800);
    expect(textToStored('12.5', 'pct')).toBe(1250);
    expect(textToStored('1.5', 'mult')).toBe(15000);
  });
  it('round-trips', () => {
    for (const [v, k] of [[9500, 'cents'], [29, 'cents'], [1250, 'pct'], [15000, 'mult']] as const)
      expect(textToStored(storedToText(v, k), k)).toBe(v);
  });
  it('rejects junk', () => {
    expect(textToStored('abc', 'cents')).toBeNull();
  });
});
