/**
 * Builder form model: string-valued form state, its mapping to the engine input
 * (the SAME mapping the server uses in netlify/lib/estimateServer.ts engineInput),
 * to the saved rows, and the validation that gates autosave.
 */
import {
  ACCESS_KEYS,
  ADDON_KEYS,
  PACKING_METHODS,
  computeEstimate,
  type EstimateInput,
  type EstimateResult,
  type LineCategory,
  type LineOverride,
  type ManualLine,
  type PackingMethod,
  type RateSnapshot,
} from '../../../shared/estimate';
import { toE164, type JobType, type StopKind } from '../../../shared/dispatch';
import type { EstimateFull, EstimateInputsPatch, ItemInput, StopInput } from '../data';

export interface StopForm {
  kind: StopKind;
  site_name: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  access_flags: string[];
  access_notes: string;
  /** Miles from the previous stop (one decimal). Blank for the first stop. */
  miles: string;
  window_start: string | null;
  window_end: string | null;
}
export interface ItemForm {
  id: string;
  description: string;
  artist_title: string;
  medium: string;
  height_in: string;
  width_in: string;
  depth_in: string;
  weight_lbs: string;
  quantity: string;
  /** Declared value in dollars. */
  declared: string;
  handling_flags: string[];
  /** '' = use the engine's suggestion. */
  packing_method: '' | PackingMethod;
  packing_override_reason: string;
}
export interface ManualForm {
  id: string;
  category: Exclude<LineCategory, 'discount' | 'tax'>;
  description: string;
  qty: string;
  unit: string;
  price: string;
  cost: string;
  client_visible: boolean;
}
export interface Draft {
  title: string;
  client_id: string;
  contact_id: string;
  service_type: JobType;
  requested_date: string;
  notes_internal: string;
  notes_client: string;
  vehicle_key: string;
  vehicle_hours: string;
  labor_hours: string;
  crew_count: string;
  crew_reason: string;
  after_hours: boolean;
  weekend: boolean;
  rush: boolean;
  equipment: { key: string; days: string }[];
  access: Record<string, string>;
  addons: Record<string, string>;
  /** Percent; blank = the client's default. */
  discount_pct: string;
  overrides: Record<string, LineOverride>;
  manual: ManualForm[];
  stops: StopForm[];
  items: ItemForm[];
}

export const newId = () => crypto.randomUUID();
export const emptyStop = (kind: StopKind = 'stop'): StopForm => ({
  kind,
  site_name: '',
  address: '',
  contact_name: '',
  contact_phone: '',
  access_flags: [],
  access_notes: '',
  miles: '',
  window_start: null,
  window_end: null,
});
export const emptyItem = (): ItemForm => ({
  id: newId(),
  description: '',
  artist_title: '',
  medium: '',
  height_in: '',
  width_in: '',
  depth_in: '',
  weight_lbs: '',
  quantity: '1',
  declared: '',
  handling_flags: [],
  packing_method: '',
  packing_override_reason: '',
});
export const emptyManual = (): ManualForm => ({ id: newId(), category: 'other', description: '', qty: '1', unit: 'each', price: '', cost: '', client_visible: true });

const s = (v: unknown) => (v == null ? '' : String(v));
export const centsToInput = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
/** Blank or unreadable → null. */
export function num(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}
const dollarsToCents = (v: string): number | null => {
  const x = num(v);
  return x == null ? null : Math.round(x * 100);
};
const decimals = (x: number, places: number) => Math.abs(x * 10 ** places - Math.round(x * 10 ** places)) < 1e-6;

type Inputs = {
  options?: {
    vehicle_key?: string | null;
    vehicle_hours?: number;
    labor_hours?: number;
    crew_override?: { count: number; reason: string } | null;
    after_hours?: boolean;
    weekend?: boolean;
    rush?: boolean;
    equipment?: { key: string; days: number }[];
    access?: Record<string, number>;
    addons?: Record<string, number>;
    discount_bp?: number | null;
  };
  overrides?: Record<string, LineOverride>;
  manual_lines?: ManualLine[];
};

export function draftFromEstimate(e: EstimateFull): Draft {
  const inp = (e.inputs ?? {}) as Inputs;
  const o = inp.options ?? {};
  const rec = (m: Record<string, number> | undefined) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, String(v)]));
  return {
    title: e.title,
    client_id: e.client_id ?? '',
    contact_id: e.contact_id ?? '',
    service_type: e.service_type,
    requested_date: e.requested_date ?? '',
    notes_internal: e.notes_internal ?? '',
    notes_client: e.notes_client ?? '',
    vehicle_key: o.vehicle_key ?? '',
    vehicle_hours: o.vehicle_hours ? String(o.vehicle_hours) : '',
    labor_hours: o.labor_hours ? String(o.labor_hours) : '',
    crew_count: o.crew_override ? String(o.crew_override.count) : '',
    crew_reason: o.crew_override?.reason ?? '',
    after_hours: !!o.after_hours,
    weekend: !!o.weekend,
    rush: !!o.rush,
    equipment: (o.equipment ?? []).map((x) => ({ key: x.key, days: String(x.days) })),
    access: rec(o.access),
    addons: rec(o.addons),
    discount_pct: o.discount_bp == null ? '' : String(o.discount_bp / 100),
    overrides: inp.overrides ?? {},
    manual: (inp.manual_lines ?? []).map((m) => ({
      id: m.id,
      category: m.category as ManualForm['category'],
      description: m.description,
      qty: String(m.qty),
      unit: m.unit,
      price: centsToInput(m.unit_price_cents),
      cost: centsToInput(m.unit_cost_cents),
      client_visible: m.client_visible,
    })),
    stops: e.stops.map((st) => ({
      kind: st.kind,
      site_name: s(st.site_name),
      address: st.address,
      contact_name: s(st.contact_name),
      contact_phone: st.contact_phone ?? '',
      access_flags: st.access_flags,
      access_notes: s(st.access_notes),
      miles: st.miles_from_previous == null ? '' : String(st.miles_from_previous),
      window_start: st.window_start,
      window_end: st.window_end,
    })),
    items: e.items.map((i) => ({
      id: i.id,
      description: i.description,
      artist_title: s(i.artist_title),
      medium: s(i.medium),
      height_in: s(i.height_in),
      width_in: s(i.width_in),
      depth_in: s(i.depth_in),
      weight_lbs: s(i.weight_lbs),
      quantity: String(i.quantity),
      declared: centsToInput(i.declared_value_cents == null ? null : Number(i.declared_value_cents)),
      handling_flags: i.handling_flags,
      packing_method: (i.packing_method as PackingMethod | null) ?? '',
      packing_override_reason: s(i.packing_override_reason),
    })),
  };
}

function manualLines(d: Draft): ManualLine[] {
  return d.manual.map((m) => ({
    id: m.id,
    category: m.category,
    description: m.description,
    qty: num(m.qty) ?? 0,
    unit: m.unit,
    unit_price_cents: m.client_visible ? (dollarsToCents(m.price) ?? 0) : 0,
    unit_cost_cents: dollarsToCents(m.cost) ?? 0,
    client_visible: m.client_visible,
  }));
}

function numMap(m: Record<string, string>, keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const x = num(m[k] ?? '');
    if (x && x > 0) out[k] = x;
  }
  return out;
}

function options(d: Draft) {
  const count = num(d.crew_count);
  const disc = num(d.discount_pct);
  return {
    vehicle_key: d.vehicle_key || null,
    vehicle_hours: num(d.vehicle_hours) ?? 0,
    labor_hours: num(d.labor_hours) ?? 0,
    crew_override: count != null ? { count, reason: d.crew_reason.trim() } : null,
    after_hours: d.after_hours,
    weekend: d.weekend,
    rush: d.rush,
    equipment: d.equipment.map((x) => ({ key: x.key, days: num(x.days) ?? 0 })).filter((x) => x.key && x.days > 0),
    access: numMap(d.access, ACCESS_KEYS),
    addons: numMap(d.addons, ADDON_KEYS),
    discount_bp: disc == null ? null : Math.round(disc * 100),
  };
}

/** Same mapping as the server's engineInput(), from the form state. */
export function buildEngineInput(d: Draft, clientDiscountBp: number): EstimateInput {
  return {
    options: { ...options(d), service_type: d.service_type } as EstimateInput['options'],
    overrides: d.overrides,
    manual_lines: manualLines(d),
    client_default_discount_bp: clientDiscountBp,
    stops: d.stops.map((st) => ({ miles_from_previous: num(st.miles) })),
    items: d.items.map((i) => ({
      id: i.id,
      description: i.description,
      medium: i.medium.trim() || null,
      height_in: num(i.height_in),
      width_in: num(i.width_in),
      depth_in: num(i.depth_in),
      weight_lbs: num(i.weight_lbs),
      quantity: Math.max(1, Math.round(num(i.quantity) ?? 1)),
      declared_value_cents: dollarsToCents(i.declared),
      handling_flags: i.handling_flags,
      packing_method: i.packing_method || null,
    })),
  };
}

export function runEngine(d: Draft, clientDiscountBp: number, snap: RateSnapshot): { result: EstimateResult | null; error: string | null } {
  try {
    return { result: computeEstimate(buildEngineInput(d, clientDiscountBp), snap), error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

export function draftToPatch(d: Draft): EstimateInputsPatch {
  return {
    title: d.title.trim(),
    client_id: d.client_id || null,
    contact_id: d.contact_id || null,
    service_type: d.service_type,
    requested_date: d.requested_date || null,
    inputs: { options: options(d), overrides: d.overrides, manual_lines: manualLines(d) },
    notes_internal: d.notes_internal.trim() || null,
    notes_client: d.notes_client.trim() || null,
  };
}
export const draftStops = (d: Draft): StopInput[] =>
  d.stops.map((st) => ({
    kind: st.kind,
    site_name: st.site_name.trim() || null,
    address: st.address.trim(),
    contact_name: st.contact_name.trim() || null,
    contact_phone: st.contact_phone.trim() ? toE164(st.contact_phone) : null,
    window_start: st.window_start,
    window_end: st.window_end,
    access_flags: st.access_flags,
    access_notes: st.access_notes.trim() || null,
    miles_from_previous: num(st.miles),
  }));
export const draftItems = (d: Draft): ItemInput[] =>
  d.items.map((i) => ({
    id: i.id,
    description: i.description.trim(),
    artist_title: i.artist_title.trim() || null,
    medium: i.medium.trim() || null,
    height_in: num(i.height_in),
    width_in: num(i.width_in),
    depth_in: num(i.depth_in),
    weight_lbs: num(i.weight_lbs),
    quantity: Math.max(1, Math.round(num(i.quantity) ?? 1)),
    declared_value_cents: dollarsToCents(i.declared),
    handling_flags: i.handling_flags,
    packing_method: i.packing_method || null,
    packing_override_reason: i.packing_method ? i.packing_override_reason.trim() : null,
  }));

export type Errors = Record<string, string>;

/** Field-level problems. Any error blocks autosave (the screen keeps calculating). */
export function validate(d: Draft): Errors {
  const e: Errors = {};
  const range = (key: string, v: string, label: string, min: number, max: number, places: number, minExclusive = false) => {
    if (v.trim() === '') return;
    const x = num(v);
    if (x == null) e[key] = `${label} must be a number.`;
    else if (minExclusive ? x <= min : x < min) e[key] = `${label} must be ${minExclusive ? 'more than' : 'at least'} ${min}.`;
    else if (x > max) e[key] = `${label} must be ${max.toLocaleString('en-US')} or less.`;
    else if (!decimals(x, places)) e[key] = `${label}: up to ${places} decimal place${places === 1 ? '' : 's'}.`;
  };
  if (d.title.trim().length < 2) e.title = 'Add a title (at least 2 characters).';
  range('vehicle_hours', d.vehicle_hours, 'Vehicle hours', 0, 240, 2);
  range('labor_hours', d.labor_hours, 'Labor hours', 0, 240, 2);
  range('discount_pct', d.discount_pct, 'Discount', 0, 100, 2);
  if (d.crew_count.trim() !== '') {
    range('crew_count', d.crew_count, 'Crew', 1, 20, 0);
    if (!e.crew_count && !Number.isInteger(num(d.crew_count))) e.crew_count = 'Crew must be a whole number.';
    if (d.crew_reason.trim().length < 3) e.crew_reason = 'A crew override needs a reason (at least 3 characters).';
  }
  d.equipment.forEach((x, i) => range(`equipment.${i}`, x.days, 'Days', 0, 365, 2));
  for (const [k, v] of [...Object.entries(d.access), ...Object.entries(d.addons)]) range(`qty.${k}`, v, 'Quantity', 0, 10000, 2);
  d.stops.forEach((st, i) => {
    if (st.address.trim().length < 3) e[`stop.${i}.address`] = 'Add an address (at least 3 characters).';
    if (st.contact_phone.trim() && !toE164(st.contact_phone)) e[`stop.${i}.phone`] = 'Use a full phone number, e.g. 323 555 1234.';
    range(`stop.${i}.miles`, st.miles, 'Miles', 0, 5000, 1);
  });
  d.items.forEach((it) => {
    const k = `item.${it.id}`;
    if (it.description.trim().length < 2) e[`${k}.description`] = 'Add a description (at least 2 characters).';
    for (const f of ['height_in', 'width_in', 'depth_in'] as const) range(`${k}.${f}`, it[f], 'Size', 0, 1200, 2, true);
    range(`${k}.weight_lbs`, it.weight_lbs, 'Weight', 0, 40000, 1, true);
    range(`${k}.quantity`, it.quantity, 'Quantity', 1, 999, 0);
    if (!e[`${k}.quantity`] && it.quantity.trim() !== '' && !Number.isInteger(num(it.quantity))) e[`${k}.quantity`] = 'Quantity must be a whole number.';
    range(`${k}.declared`, it.declared, 'Declared value', 0, 1_000_000_000, 2);
    if (it.packing_method && !PACKING_METHODS.includes(it.packing_method)) e[`${k}.packing`] = 'Unknown packing method.';
    if (it.packing_method && it.packing_override_reason.trim().length < 3) e[`${k}.reason`] = 'Changing the packing method needs a reason (at least 3 characters).';
  });
  d.manual.forEach((m) => {
    const k = `manual.${m.id}`;
    if (m.description.trim().length < 2) e[`${k}.description`] = 'Add a description.';
    range(`${k}.qty`, m.qty, 'Quantity', 0, 100000, 2);
    range(`${k}.price`, m.price, 'Price', 0, 1_000_000, 2);
    range(`${k}.cost`, m.cost, 'Cost', 0, 1_000_000, 2);
    if (!m.client_visible && (num(m.price) ?? 0) !== 0) e[`${k}.price`] = 'Internal lines must have a price of $0.';
  });
  for (const [key, ov] of Object.entries(d.overrides)) {
    if ((ov.reason ?? '').trim().length < 3) e[`override.${key}`] = 'An override needs a reason.';
  }
  return e;
}
