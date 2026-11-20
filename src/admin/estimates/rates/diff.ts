import type { Kind } from './scaled';

/** Deep equality for plain JSON values. */
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function setAt(obj: unknown, path: string, value: unknown): void {
  const segs = path.split('.');
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]] as Record<string, unknown>;
  cur[segs[segs.length - 1]] = value;
}

export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

/** Every leaf (or whole row where one side has no such row) that differs between two cards. */
export function diffLeaves(before: unknown, after: unknown, path = ''): Change[] {
  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (Array.isArray(before) && Array.isArray(after)) {
    // Arrays of scalars (tax categories) compare as one value.
    if ([...before, ...after].every((v) => typeof v !== 'object')) return same(before, after) ? [] : [{ path, before, after }];
    const out: Change[] = [];
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) {
      if (i >= before.length || i >= after.length) out.push({ path: `${path}.${i}`, before: before[i], after: after[i] });
      else out.push(...diffLeaves(before[i], after[i], `${path}.${i}`));
    }
    return out;
  }
  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    return [...keys].flatMap((k) => diffLeaves((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return same(before, after) ? [] : [{ path, before, after }];
}

const MONEY_KEYS = new Set(['bill', 'cost', 'minimum', 'minimum_bill', 'min_job_charge']);
const SECTION_LABEL: Record<string, string> = {
  labor: 'Labor', vehicles: 'Vehicles', equipment: 'Equipment', distance_tiers: 'Distance tiers', shipping: 'Shipping',
  crating: 'Crating', removal: 'Install & removal', insurance: 'Insurance', access: 'Access surcharges', addons: 'Add-ons',
  premiums: 'Premiums', policy: 'Policy',
};

export function kindForPath(path: string): Kind {
  const last = path.split('.').pop() ?? '';
  if (MONEY_KEYS.has(last)) return 'cents';
  if (last.endsWith('_bp')) return last.includes('multiplier') || last === 'lumber_factor_bp' ? 'mult' : 'pct';
  return 'num';
}

/** "Labor > positions > lead > bill" with row numbers as "row 2". */
export function pathLabel(path: string): string {
  return path
    .split('.')
    .map((s, i) => (/^\d+$/.test(s) ? `row ${Number(s) + 1}` : i === 0 ? (SECTION_LABEL[s] ?? s) : s.replace(/_bp$/, '').replace(/_/g, ' ')))
    .join(' › ');
}
