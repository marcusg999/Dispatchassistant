/**
 * Money math for estimates. Everything is integer cents; percentages are integer
 * basis points (1% = 100 bp). Quantities are stored in hundredths (2 decimals).
 * Rounding is half-up (away from zero for positives), applied once per line.
 */

/** Round a non-negative rational a/b half-up to an integer. */
export function divRoundHalfUp(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b) || b <= 0) throw new Error(`divRoundHalfUp needs integers, got ${a}/${b}`);
  const neg = a < 0;
  const abs = Math.abs(a);
  const q = Math.floor(abs / b);
  const r = abs - q * b;
  const out = r * 2 >= b ? q + 1 : q;
  return neg ? -out : out;
}

/** Quantity (e.g. 2.5 hours) → integer hundredths, rejecting more than 2 decimals of noise. */
export function toHundredths(qty: number): number {
  const h = Math.round(qty * 100);
  if (Math.abs(h - qty * 100) > 1e-6) throw new Error(`Quantity ${qty} has more than 2 decimals`);
  return h;
}

/** qty × unit cents, rounded half-up to the cent. */
export function lineAmount(qty: number, unitCents: number): number {
  return divRoundHalfUp(toHundredths(qty) * unitCents, 100);
}

/** amount × bp / 10000, rounded half-up. */
export function applyBp(amountCents: number, bp: number): number {
  return divRoundHalfUp(amountCents * bp, 10_000);
}

export function formatCents(cents: number, locale = 'en-US', currency = 'USD'): string {
  const neg = cents < 0;
  const s = (Math.abs(cents) / 100).toLocaleString(locale, { style: 'currency', currency });
  return neg ? `−${s}` : s;
}

export function formatBp(bp: number): string {
  return `${(bp / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

/** Round up to a multiple of `step` (e.g. quarter hours). Works on hundredths. */
export function ceilToStep(value: number, step: number): number {
  const v = toHundredths(value);
  const s = toHundredths(step);
  return (Math.ceil(v / s) * s) / 100;
}
