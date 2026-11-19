/**
 * The ONLY browser storage the portal ever uses: the optional, off-by-default
 * "remember my tracking codes on this device" list. Nothing is written unless the
 * submitter turns it on. Every access is guarded (private mode can throw).
 */
const KEY = 'remembered-codes';

export function rememberedCodes(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function rememberCode(code: string): boolean {
  try {
    const list = [code, ...rememberedCodes().filter((c) => c !== code)].slice(0, 20);
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function forgetCode(code: string): void {
  try {
    const list = rememberedCodes().filter((c) => c !== code);
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
