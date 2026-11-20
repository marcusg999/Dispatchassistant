/**
 * Exact decimal text <-> scaled integer conversion. Money is typed in dollars and stored as
 * integer cents; percentages are typed as % and stored as basis points. We parse the digits
 * of the string (never multiply a float) so 1.005 and 19.99 never drift.
 */

export type Kind = 'cents' | 'pct' | 'mult' | 'num';

/** decimals = digits after the point in the typed text; the stored value is text x 10^decimals. */
export const KIND_DECIMALS: Record<Exclude<Kind, 'num'>, number> = { cents: 2, pct: 2, mult: 4 };

/** "12.5" with 2 decimals gives 1250. Returns null for anything that is not a plain non-negative decimal. */
export function parseScaled(text: string, decimals: number): number | null {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [whole, frac = ''] = t.split('.');
  const kept = frac.slice(0, decimals).padEnd(decimals, '0');
  let n = Number((whole || '0') + kept);
  // Round half-up on the first dropped digit.
  if (frac.length > decimals && frac.charCodeAt(decimals) >= 53) n += 1;
  return Number.isSafeInteger(n) ? n : null;
}

/** 1250 with 2 decimals gives "12.50" (fixed) or "12.5" (trimmed). */
export function formatScaled(value: number, decimals: number, trim: boolean): string {
  if (!Number.isFinite(value)) return '';
  const neg = value < 0;
  const abs = Math.abs(Math.round(value));
  const s = String(abs).padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  let frac = s.slice(s.length - decimals);
  if (trim) frac = frac.replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Typed text to stored value for a field kind (null = not a number yet). */
export function textToStored(text: string, kind: Kind): number | null {
  if (kind === 'num') {
    const t = text.trim();
    if (!/^\d+\.?\d*$|^\.\d+$/.test(t)) return null;
    return Number(t);
  }
  return parseScaled(text, KIND_DECIMALS[kind]);
}

/** Stored value to the text shown in the box. */
export function storedToText(value: number, kind: Kind): string {
  if (kind === 'num') return String(value);
  return formatScaled(value, KIND_DECIMALS[kind], kind !== 'cents');
}

/** Short human text for the compare view and change list. */
export function displayStored(value: unknown, kind: Kind | 'text'): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value !== 'number') return value === undefined || value === null || value === '' ? '(empty)' : String(value);
  if (kind === 'cents') return `$${formatScaled(value, 2, false)}`;
  if (kind === 'pct') return `${formatScaled(value, 2, true)}%`;
  if (kind === 'mult') return `×${formatScaled(value, 4, true)}`;
  return String(value);
}

export const fmtMoney = (cents: number) => displayStored(cents, 'cents');
