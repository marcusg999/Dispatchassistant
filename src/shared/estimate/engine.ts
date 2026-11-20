/**
 * Estimate engine. Pure and deterministic: estimate inputs + a rate snapshot in,
 * priced lines + crew suggestion + crate takeoff out. No I/O, no Date.now().
 *
 * Money: integer cents. Percentages: basis points. Dimensions are converted to
 * integer hundredths of an inch before any multiplication so results never depend
 * on floating-point noise. Each line is rounded once (half-up) from qty × unit.
 */
import { applyBp, ceilToStep, divRoundHalfUp, lineAmount } from './money';
import {
  CRATE_METHODS,
  PACKING_LABEL,
  type AccessKey,
  type AddonKey,
  type CrewRule,
  type PackingMethod,
  type PackingRule,
  type Rates,
} from './rates';

export const LINE_CATEGORIES = [
  'transport', 'packing_crating', 'labor', 'equipment', 'insurance', 'access', 'addons', 'storage', 'discount', 'tax', 'other',
] as const;
export type LineCategory = (typeof LINE_CATEGORIES)[number];
export const LINE_CATEGORY_LABEL: Record<LineCategory, string> = {
  transport: 'Transport',
  packing_crating: 'Packing & crating',
  labor: 'Labor',
  equipment: 'Equipment',
  insurance: 'Insurance / valuation',
  access: 'Access surcharges',
  addons: 'Add-ons',
  storage: 'Storage',
  discount: 'Discount',
  tax: 'Tax',
  other: 'Other',
};

export type ServiceType =
  | 'pickup' | 'delivery' | 'install' | 'deinstall' | 'crating' | 'shuttle' | 'storage_in' | 'storage_out' | 'site_survey';

export interface EstimateItemInput {
  id: string;
  description: string;
  medium?: string | null;
  height_in?: number | null;
  width_in?: number | null;
  depth_in?: number | null;
  weight_lbs?: number | null;
  quantity: number;
  declared_value_cents?: number | null;
  handling_flags: string[];
  /** Chosen packing; null = use the suggestion. */
  packing_method?: PackingMethod | null;
}

export interface EstimateStopInput {
  /** Miles from the previous stop (null for the first stop). Entered manually in Phase 3. */
  miles_from_previous?: number | null;
}

export interface LineOverride {
  qty?: number;
  unit_price_cents?: number;
  unit_cost_cents?: number;
  reason: string;
}

export interface ManualLine {
  id: string;
  category: LineCategory;
  description: string;
  qty: number;
  unit: string;
  unit_price_cents: number;
  unit_cost_cents: number;
  client_visible: boolean;
}

export interface EstimateOptions {
  service_type: ServiceType;
  vehicle_key?: string | null;
  vehicle_hours?: number;
  /** On-site / driving labor hours for the job (install/de-install hours are added on top). */
  labor_hours?: number;
  crew_override?: { count: number; reason: string } | null;
  after_hours?: boolean;
  weekend?: boolean;
  rush?: boolean;
  /** Extra equipment by key with days (required equipment is added automatically). */
  equipment?: { key: string; days: number }[];
  access?: Partial<Record<AccessKey, number>>;
  addons?: Partial<Record<AddonKey, number>>;
  /** null/undefined = client's default discount. */
  discount_bp?: number | null;
}

export interface EstimateInput {
  options: EstimateOptions;
  stops: EstimateStopInput[];
  items: EstimateItemInput[];
  overrides?: Record<string, LineOverride>;
  manual_lines?: ManualLine[];
  client_default_discount_bp?: number;
}

export interface RateSnapshot {
  rates: Rates;
  packing_rules: PackingRule[];
  crew_rules: CrewRule[];
}

export interface EstimateLine {
  key: string;
  category: LineCategory;
  description: string;
  qty: number;
  unit: string;
  unit_price_cents: number;
  unit_cost_cents: number;
  amount_cents: number;
  cost_cents: number;
  source: 'calc' | 'manual';
  client_visible: boolean;
  item_id?: string;
  overridden: boolean;
  original?: { qty: number; unit_price_cents: number; unit_cost_cents: number };
  override_reason?: string;
  /** Plain-language "how this was calculated". */
  trace: string;
}

export interface CrateTakeoff {
  item_id: string;
  description: string;
  method: PackingMethod;
  quantity: number;
  inner_in: [number, number, number];
  outer_in: [number, number, number];
  plywood_sheets: number;
  lumber_lf: number;
  foam_bf: number;
  hardware_kits: number;
  size_class: string;
  shop_hours: number;
  handling_flags: string[];
  medium: string | null;
}

export interface EstimateResult {
  lines: EstimateLine[];
  crew: { suggested: number; applied: number; reasons: string[]; overridden: boolean; positions: Record<string, number> };
  packing: { item_id: string; suggested: PackingMethod; chosen: PackingMethod; reason: string }[];
  crates: CrateTakeoff[];
  distance: { total_miles: number; tier_label: string; multiplier_bp: number };
  billable_weight_lb: number;
  required_equipment: string[];
  totals: {
    subtotal_cents: number;
    discount_bp: number;
    discount_cents: number;
    tax_cents: number;
    total_cents: number;
    cost_cents: number;
    margin_cents: number;
    margin_bp: number;
  };
  flags: {
    needs_approval: boolean;
    approval_reasons: string[];
    below_target_margin: boolean;
    minimum_applied: boolean;
  };
  warnings: string[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Inches (up to 2 decimals) → integer hundredths. */
const h = (inches: number | null | undefined): number => Math.round((inches ?? 0) * 100);
const fromH = (hundredths: number): number => hundredths / 100;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const pctText = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
const SHEET_SQIN = 48 * 96;

function line(partial: Omit<EstimateLine, 'amount_cents' | 'cost_cents' | 'overridden' | 'source' | 'client_visible'> & { client_visible?: boolean; source?: 'calc' | 'manual' }): EstimateLine {
  return {
    source: 'calc',
    client_visible: true,
    ...partial,
    amount_cents: lineAmount(partial.qty, partial.unit_price_cents),
    cost_cents: lineAmount(partial.qty, partial.unit_cost_cents),
    overridden: false,
  };
}

function hasDims(i: EstimateItemInput) {
  return (i.height_in ?? 0) > 0 && (i.width_in ?? 0) > 0 && (i.depth_in ?? 0) > 0;
}

export function totalMiles(stops: EstimateStopInput[]): number {
  // Sum in tenths to stay exact.
  const tenths = stops.reduce((s, x) => s + Math.round((x.miles_from_previous ?? 0) * 10), 0);
  return tenths / 10;
}

export function distanceTier(rates: Rates, miles: number) {
  const tiers = [...rates.distance_tiers].sort((a, b) => a.up_to_miles - b.up_to_miles);
  return tiers.find((t) => miles <= t.up_to_miles) ?? tiers[tiers.length - 1] ?? { label: '—', up_to_miles: Infinity, per_mile_multiplier_bp: 10_000 };
}

export function suggestPacking(item: EstimateItemInput, snap: RateSnapshot, miles: number): { method: PackingMethod; reason: string } {
  const { rates } = snap;
  const medium = (item.medium ?? '').toLowerCase();
  const localLimit = [...rates.distance_tiers].sort((a, b) => a.up_to_miles - b.up_to_miles)[0]?.up_to_miles ?? 0;
  const longHaul = miles > localLimit;
  const maxSide = Math.max(item.height_in ?? 0, item.width_in ?? 0, item.depth_in ?? 0);
  const cond: Record<PackingRule['condition'], boolean> = {
    any: true,
    local: !longHaul,
    long_haul: longHaul,
    glazed: item.handling_flags.includes('glass'),
    heavy: (item.weight_lbs ?? 0) >= rates.crating.heavy_item_lb,
    small: maxSide > 0 && maxSide <= rates.crating.small_item_max_side_in,
  };
  for (const r of [...snap.packing_rules].sort((a, b) => a.position - b.position)) {
    if (medium.includes(r.medium_match.toLowerCase()) && cond[r.condition]) return { method: r.method, reason: r.note || `Rule: ${r.medium_match} (${r.condition})` };
  }
  return { method: rates.crating.default_method, reason: 'No packing rule matched the medium; using the default packing method.' };
}

function sizeClass(rates: Rates, maxSideH: number) {
  const classes = [...rates.crating.size_classes].sort((a, b) => a.max_side_in - b.max_side_in);
  return classes.find((c) => maxSideH <= h(c.max_side_in)) ?? classes[classes.length - 1];
}

/** Crate geometry and materials takeoff for ONE crate. Dimensions in hundredths internally. */
export function crateTakeoff(item: EstimateItemInput, method: PackingMethod, rates: Rates): Omit<CrateTakeoff, 'item_id' | 'description' | 'quantity' | 'handling_flags' | 'medium'> {
  const pad = h(rates.shipping.padding_in[method] ?? 0);
  const wall = h(rates.crating.wall_thickness_in);
  const inner = [h(item.height_in), h(item.width_in), h(item.depth_in)].map((d) => d + 2 * pad) as [number, number, number];
  const outer = inner.map((d) => d + 2 * wall) as [number, number, number];
  const [H, W, D] = outer;
  const isSkid = method === 'skid_bracing';
  // Areas in (hundredths in)^2 → divide by 10_000 for sq in.
  const outerArea = isSkid ? W * D : 2 * (H * W + H * D + W * D);
  const withWaste = outerArea * (10_000 + rates.crating.plywood_waste_bp); // × bp
  const sheets = Math.max(1, Math.ceil(withWaste / (SHEET_SQIN * 10_000 * 10_000)));
  // Edge length: 4(H+W+D) hundredths of an inch → feet = /1200; × lumber factor (bp).
  const lumber = Math.ceil((4 * (H + W + D) * rates.crating.lumber_factor_bp) / (1200 * 10_000));
  // Foam board feet: inner surface (sq in) × thickness (in) / 144. Skids are blocked, not foamed.
  const innerArea = 2 * (inner[0] * inner[1] + inner[0] * inner[2] + inner[1] * inner[2]); // (h)^2
  const foam = isSkid ? 0 : Math.ceil((innerArea * h(rates.crating.foam_thickness_in)) / (144 * 1_000_000));
  const maxSide = Math.max(H, W, D);
  const cls = sizeClass(rates, maxSide);
  return {
    method,
    inner_in: inner.map(fromH) as [number, number, number],
    outer_in: outer.map(fromH) as [number, number, number],
    plywood_sheets: sheets,
    lumber_lf: lumber,
    foam_bf: foam,
    hardware_kits: 1,
    size_class: cls?.label ?? '—',
    shop_hours: cls?.shop_hours ?? 0,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

export function computeEstimate(input: EstimateInput, snap: RateSnapshot): EstimateResult {
  const { rates } = snap;
  const o = input.options;
  const lines: EstimateLine[] = [];
  const warnings: string[] = [];
  const miles = totalMiles(input.stops);
  const tier = distanceTier(rates, miles);

  // 1. Packing choice per item.
  const packing = input.items.map((it) => {
    const s = suggestPacking(it, snap, miles);
    return { item_id: it.id, suggested: s.method, chosen: it.packing_method ?? s.method, reason: s.reason };
  });
  const methodOf = (id: string) => packing.find((p) => p.item_id === id)!.chosen;

  // 2. Shipping: billable weight and oversize.
  let billable = 0;
  const weightTrace: string[] = [];
  for (const it of input.items) {
    const m = methodOf(it.id);
    const pad = h(rates.shipping.padding_in[m] ?? 0);
    const wall = CRATE_METHODS.includes(m) ? h(rates.crating.wall_thickness_in) : 0;
    const dims = [h(it.height_in), h(it.width_in), h(it.depth_in)].map((d) => d + 2 * (pad + wall));
    const actual = Math.ceil(it.weight_lbs ?? 0);
    let dimW = 0;
    if (hasDims(it)) {
      // volume in (h)^3 / 1e6 = cu in; / divisor = lb (rounded up).
      dimW = Math.ceil((dims[0] * dims[1] * dims[2]) / (1_000_000 * rates.shipping.dim_divisor));
    } else {
      warnings.push(`“${it.description}” has no dimensions: dimensional weight not counted.`);
    }
    if (!it.weight_lbs) warnings.push(`“${it.description}” has no weight.`);
    const per = Math.max(actual, dimW);
    billable += per * it.quantity;
    weightTrace.push(`${it.quantity}× ${it.description}: max(actual ${actual} lb, dimensional ${dimW} lb) = ${per} lb`);
    const maxSide = Math.max(...dims);
    const sum = dims.reduce((a, b) => a + b, 0);
    if (hasDims(it) && (maxSide > h(rates.shipping.oversize_max_side_in) || sum > h(rates.shipping.oversize_sum_in))) {
      lines.push(
        line({
          key: `shipping.oversize:${it.id}`,
          category: 'transport',
          description: `Oversize handling: ${it.description}`,
          qty: it.quantity,
          unit: 'piece',
          unit_price_cents: rates.shipping.oversize_fee.bill,
          unit_cost_cents: rates.shipping.oversize_fee.cost,
          item_id: it.id,
          trace: `Packed size ${dims.map(fromH).join(' × ')} in: largest side ${fromH(maxSide)} in (limit ${rates.shipping.oversize_max_side_in}), L+W+H ${fromH(sum)} in (limit ${rates.shipping.oversize_sum_in}) → oversize fee ${money(rates.shipping.oversize_fee.bill)} × ${it.quantity}.`,
        }),
      );
    }
  }
  if (billable > 0) {
    lines.push(
      line({
        key: 'shipping.weight',
        category: 'transport',
        description: `Weight handling (${billable.toLocaleString('en-US')} lb billable)`,
        qty: billable / 100,
        unit: 'cwt',
        unit_price_cents: rates.shipping.per_cwt.bill,
        unit_cost_cents: rates.shipping.per_cwt.cost,
        trace: `Dimensional weight = packed L×W×H ÷ ${rates.shipping.dim_divisor}. ${weightTrace.join('; ')}. Total ${billable} lb = ${billable / 100} cwt × ${money(rates.shipping.per_cwt.bill)}/cwt.`,
      }),
    );
  }

  // 3. Vehicle time and mileage.
  const transportKeys: string[] = [];
  if (o.vehicle_key) {
    const v = rates.vehicles.find((x) => x.key === o.vehicle_key);
    if (!v) warnings.push(`Vehicle “${o.vehicle_key}” isn’t on this rate card.`);
    else {
      const hours = ceilToStep(o.vehicle_hours ?? 0, rates.labor.hour_step);
      if (hours > 0) {
        lines.push(line({ key: 'transport.vehicle_time', category: 'transport', description: `${v.label}: time`, qty: hours, unit: 'hour', unit_price_cents: v.per_hour.bill, unit_cost_cents: v.per_hour.cost, trace: `${hours} h (rounded up to ${rates.labor.hour_step} h) × ${money(v.per_hour.bill)}/h.` }));
        transportKeys.push('transport.vehicle_time');
      }
      if (miles > 0) {
        const pm = applyBp(v.per_mile.bill, tier.per_mile_multiplier_bp);
        const pmc = applyBp(v.per_mile.cost, tier.per_mile_multiplier_bp);
        lines.push(line({ key: 'transport.miles', category: 'transport', description: `${v.label}: mileage (${tier.label})`, qty: miles, unit: 'mile', unit_price_cents: pm, unit_cost_cents: pmc, trace: `${miles} mi total → ${tier.label} tier (up to ${tier.up_to_miles} mi): ${money(v.per_mile.bill)}/mi × ${pctText(tier.per_mile_multiplier_bp)} = ${money(pm)}/mi.` }));
        transportKeys.push('transport.miles');
      }
      const sub = lines.filter((l) => transportKeys.includes(l.key)).reduce((s, l) => s + l.amount_cents, 0);
      if (sub < v.minimum_bill) {
        lines.push(line({ key: 'transport.vehicle_min', category: 'transport', description: `${v.label}: minimum charge`, qty: 1, unit: 'each', unit_price_cents: v.minimum_bill - sub, unit_cost_cents: 0, trace: `Vehicle time + mileage ${money(sub)} is under the ${money(v.minimum_bill)} minimum → adds ${money(v.minimum_bill - sub)}.` }));
        transportKeys.push('transport.vehicle_min');
      }
    }
  }

  // 4. Packing & crating per item.
  const crates: CrateTakeoff[] = [];
  const c = rates.crating;
  for (const it of input.items) {
    const m = methodOf(it.id);
    const paper = (it.medium ?? '').toLowerCase().includes('paper');
    const parts: { label: string; qty: number; bill: number; cost: number }[] = [];
    let extra = '';
    if (CRATE_METHODS.includes(m)) {
      if (!hasDims(it)) {
        warnings.push(`“${it.description}” needs dimensions to price a crate.`);
        continue;
      }
      const t = crateTakeoff(it, m, rates);
      crates.push({ ...t, item_id: it.id, description: it.description, quantity: it.quantity, handling_flags: it.handling_flags, medium: it.medium ?? null });
      parts.push({ label: `plywood ${t.plywood_sheets} sheet(s)`, qty: t.plywood_sheets, bill: c.plywood_sheet.bill, cost: c.plywood_sheet.cost });
      parts.push({ label: `lumber ${t.lumber_lf} lf`, qty: t.lumber_lf, bill: c.lumber_per_lf.bill, cost: c.lumber_per_lf.cost });
      if (t.foam_bf) parts.push({ label: `foam ${t.foam_bf} bf`, qty: t.foam_bf, bill: c.foam_per_bf.bill, cost: c.foam_per_bf.cost });
      parts.push({ label: 'hardware kit', qty: 1, bill: c.hardware_kit.bill, cost: c.hardware_kit.cost });
      parts.push({ label: 'paint / stencil', qty: 1, bill: c.paint_stencil.bill, cost: c.paint_stencil.cost });
      if (m === 'double_boxed') parts.push({ label: 'inner box (soft-pack kit)', qty: 1, bill: c.soft_pack_kit.bill, cost: c.soft_pack_kit.cost });
      parts.push({ label: `shop labor ${t.shop_hours} h (${t.size_class})`, qty: t.shop_hours, bill: c.shop_labor_per_hour.bill, cost: c.shop_labor_per_hour.cost });
      extra = ` (outer ${t.outer_in.join(' × ')} in)`;
    } else {
      parts.push({ label: 'soft-pack kit', qty: 1, bill: c.soft_pack_kit.bill, cost: c.soft_pack_kit.cost });
      if (m === 'travel_frame') parts.push({ label: 'travel frame kit', qty: 1, bill: c.travel_frame_kit.bill, cost: c.travel_frame_kit.cost });
    }
    if (paper) parts.push({ label: 'glassine / tissue', qty: 1, bill: c.glassine_tissue.bill, cost: c.glassine_tissue.cost });
    const unitBill = parts.reduce((s, p) => s + lineAmount(p.qty, p.bill), 0);
    const unitCost = parts.reduce((s, p) => s + lineAmount(p.qty, p.cost), 0);
    lines.push(
      line({
        key: `packing:${it.id}`,
        category: 'packing_crating',
        description: `${PACKING_LABEL[m]}: ${it.description}${extra}`,
        qty: it.quantity,
        unit: CRATE_METHODS.includes(m) ? 'crate' : 'piece',
        unit_price_cents: unitBill,
        unit_cost_cents: unitCost,
        item_id: it.id,
        trace: `Per piece: ${parts.map((p) => `${p.label} = ${money(lineAmount(p.qty, p.bill))}`).join('; ')} → ${money(unitBill)} × ${it.quantity}.`,
      }),
    );
  }

  // 5. Install / de-install hours and required equipment.
  const install = o.service_type === 'install' || o.service_type === 'deinstall';
  let removalHours = 0;
  const removalTrace: string[] = [];
  const required = new Set<string>();
  const heaviest = Math.max(0, ...input.items.map((i) => i.weight_lbs ?? 0));
  const tallest = Math.max(0, ...input.items.map((i) => i.height_in ?? 0));
  if (install) {
    const bands = [...rates.removal.hours_by_weight].sort((a, b) => a.up_to_lb - b.up_to_lb);
    for (const it of input.items) {
      const w = it.weight_lbs ?? 0;
      const band = bands.find((b) => w <= b.up_to_lb) ?? bands[bands.length - 1];
      const hrs = (band?.hours ?? 0) * it.quantity;
      removalHours += hrs;
      removalTrace.push(`${it.quantity}× ${it.description} (${w} lb): ${band?.hours ?? 0} h each`);
    }
    for (const r of rates.removal.equipment_rules) {
      if ((r.min_weight_lb > 0 && heaviest >= r.min_weight_lb) || (r.min_height_in > 0 && tallest >= r.min_height_in)) required.add(r.equipment_key);
    }
  }

  // 6. Crew size.
  const access = o.access ?? {};
  let crew = 0;
  const reasons: string[] = [];
  const allFlags = new Set(input.items.flatMap((i) => i.handling_flags));
  for (const r of [...snap.crew_rules].sort((a, b) => a.position - b.position)) {
    if (r.kind === 'base') {
      crew = r.crew;
      reasons.push(`${r.note} (${r.crew})`);
    } else if (r.kind === 'min_if_flat_over_sqft') {
      const lim = Number(r.param) * 144;
      const any = input.items.some((i) => (i.depth_in ?? 0) <= 6 && (i.height_in ?? 0) * (i.width_in ?? 0) > lim);
      if (any && crew < r.crew) {
        crew = r.crew;
        reasons.push(r.note);
      }
    } else if (r.kind === 'add_per_weight_band') {
      const band = Number(r.param);
      const add = band > 0 ? Math.floor(heaviest / band) * r.crew : 0;
      if (add > 0) {
        crew += add;
        reasons.push(`${r.note}: heaviest ${heaviest} lb → +${add}`);
      }
    } else if (r.kind === 'min_if_flag') {
      if (allFlags.has(r.param) && crew < r.crew) {
        crew = r.crew;
        reasons.push(r.note);
      }
    } else if (r.kind === 'add_if_access') {
      if ((access[r.param as AccessKey] ?? 0) > 0) {
        crew += r.crew;
        reasons.push(r.note);
      }
    } else if (r.kind === 'equipment_over_weight') {
      if (heaviest >= Number(r.param) && r.equipment_key) {
        required.add(r.equipment_key);
        reasons.push(r.note);
      }
    }
  }
  const suggested = crew;
  const applied = o.crew_override?.count ?? suggested;
  if (o.crew_override && !o.crew_override.reason.trim()) warnings.push('Crew override needs a reason.');

  // 7. Labor.
  const positions: Record<string, number> = {};
  if (applied > 0) {
    let left = applied;
    if (o.vehicle_key) {
      positions.driver = 1;
      left--;
    }
    if (applied >= 3 && left > 0) {
      positions.lead = 1;
      left--;
    }
    const restRole = install ? 'installer' : o.service_type === 'crating' ? 'crater' : 'art_handler';
    if (left > 0) positions[restRole] = (positions[restRole] ?? 0) + left;
  }
  const rawHours = (o.labor_hours ?? 0) + removalHours;
  const laborHours = applied > 0 ? ceilToStep(Math.max(rawHours, rates.labor.min_hours_per_call), rates.labor.hour_step) : 0;
  const regular = Math.min(laborHours, rates.labor.overtime_after_hours);
  const ot = Math.round((laborHours - regular) * 100) / 100;
  const mult = Math.max(10_000, o.after_hours ? rates.labor.after_hours_multiplier_bp : 10_000, o.weekend ? rates.labor.weekend_multiplier_bp : 10_000);
  const multText = mult !== 10_000 ? ` × ${pctText(mult)} (${o.after_hours ? 'after-hours' : ''}${o.after_hours && o.weekend ? ' / ' : ''}${o.weekend ? 'weekend' : ''})` : '';
  const hoursTrace = `${o.labor_hours ?? 0} h job${removalHours ? ` + ${removalHours} h install/de-install (${removalTrace.join('; ')})` : ''}, minimum ${rates.labor.min_hours_per_call} h, rounded to ${rates.labor.hour_step} h → ${laborHours} h`;
  for (const [pos, count] of Object.entries(positions)) {
    const r = rates.labor.positions[pos as keyof Rates['labor']['positions']];
    const bill = applyBp(r.bill, mult);
    const cost = applyBp(r.cost, mult);
    const label = pos.replace('_', ' ');
    if (regular > 0)
      lines.push(line({ key: `labor:${pos}`, category: 'labor', description: `Labor: ${label} × ${count}`, qty: Math.round(count * regular * 100) / 100, unit: 'person-hour', unit_price_cents: bill, unit_cost_cents: cost, trace: `${hoursTrace}. ${count} × ${regular} regular h × ${money(r.bill)}/h${multText} = ${money(bill)}/h.` }));
    if (ot > 0) {
      const ob = applyBp(bill, rates.labor.overtime_multiplier_bp);
      const oc = applyBp(cost, rates.labor.overtime_multiplier_bp);
      lines.push(line({ key: `labor_ot:${pos}`, category: 'labor', description: `Overtime: ${label} × ${count}`, qty: Math.round(count * ot * 100) / 100, unit: 'person-hour', unit_price_cents: ob, unit_cost_cents: oc, trace: `Hours over ${rates.labor.overtime_after_hours}/day: ${count} × ${ot} h × ${money(bill)} × ${pctText(rates.labor.overtime_multiplier_bp)} = ${money(ob)}/h.` }));
    }
  }

  // 8. Equipment.
  const equipDays = new Map<string, number>();
  for (const k of required) equipDays.set(k, 1);
  for (const e of o.equipment ?? []) equipDays.set(e.key, Math.max(equipDays.get(e.key) ?? 0, e.days));
  for (const [key, days] of equipDays) {
    const e = rates.equipment.find((x) => x.key === key);
    if (!e) {
      warnings.push(`Equipment “${key}” isn’t on this rate card.`);
      continue;
    }
    lines.push(line({ key: `equipment:${key}`, category: 'equipment', description: e.label, qty: days, unit: 'day', unit_price_cents: e.per_day.bill, unit_cost_cents: e.per_day.cost, trace: `${required.has(key) ? 'Required by the item weight/height rules. ' : ''}${days} day(s) × ${money(e.per_day.bill)}/day.` }));
  }

  // 9. Access surcharges and add-ons.
  for (const [k, n] of Object.entries(access) as [AccessKey, number][]) {
    if (!n) continue;
    const s = rates.access[k];
    const qty = s.mode === 'flat' ? 1 : n;
    lines.push(line({ key: `access:${k}`, category: 'access', description: s.label, qty, unit: s.unit || 'each', unit_price_cents: s.bill, unit_cost_cents: s.cost, trace: s.mode === 'flat' ? `Flat ${money(s.bill)}.` : `${qty} ${s.unit} × ${money(s.bill)}.` }));
  }
  for (const [k, n] of Object.entries(o.addons ?? {}) as [AddonKey, number][]) {
    if (!n) continue;
    const s = rates.addons[k];
    const qty = s.mode === 'flat' ? 1 : n;
    lines.push(line({ key: `addon:${k}`, category: k.startsWith('storage') ? 'storage' : 'addons', description: s.label, qty, unit: s.unit || 'each', unit_price_cents: s.bill, unit_cost_cents: s.cost, trace: s.mode === 'flat' ? `Flat ${money(s.bill)}.` : `${qty} ${s.unit} × ${money(s.bill)}.` }));
  }

  // 10. Insurance / valuation.
  const declared = input.items.reduce((s, i) => s + (i.declared_value_cents ?? 0) * i.quantity, 0);
  if (declared > 0) {
    const pct = applyBp(declared, rates.insurance.pct_bp);
    const prem = Math.max(pct, rates.insurance.minimum);
    const premCost = applyBp(declared, rates.insurance.cost_pct_bp);
    lines.push(line({ key: 'insurance', category: 'insurance', description: `Valuation coverage (declared ${money(declared)})`, qty: 1, unit: 'each', unit_price_cents: prem, unit_cost_cents: premCost, trace: `${pctText(rates.insurance.pct_bp)} of ${money(declared)} = ${money(pct)}; minimum ${money(rates.insurance.minimum)} → ${money(prem)}. Cost ${pctText(rates.insurance.cost_pct_bp)} = ${money(premCost)}.` }));
  }

  // 11. Overrides on calculated lines (original values kept).
  const ov = input.overrides ?? {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const x = ov[l.key];
    if (!x) continue;
    const qty = x.qty ?? l.qty;
    const up = x.unit_price_cents ?? l.unit_price_cents;
    const uc = x.unit_cost_cents ?? l.unit_cost_cents;
    lines[i] = {
      ...l,
      qty,
      unit_price_cents: up,
      unit_cost_cents: uc,
      amount_cents: lineAmount(qty, up),
      cost_cents: lineAmount(qty, uc),
      overridden: true,
      original: { qty: l.qty, unit_price_cents: l.unit_price_cents, unit_cost_cents: l.unit_cost_cents },
      override_reason: x.reason,
      trace: `${l.trace} Overridden: ${x.reason}`,
    };
    if (!x.reason?.trim()) warnings.push(`Override on “${l.description}” needs a reason.`);
  }

  // 12. Fuel surcharge (after overrides, on transport lines).
  const transportBill = lines.filter((l) => l.category === 'transport').reduce((s, l) => s + l.amount_cents, 0);
  const transportCost = lines.filter((l) => l.category === 'transport').reduce((s, l) => s + l.cost_cents, 0);
  if (rates.shipping.fuel_surcharge_bp > 0 && transportBill > 0) {
    const fb = applyBp(transportBill, rates.shipping.fuel_surcharge_bp);
    const fc = applyBp(transportCost, rates.shipping.fuel_surcharge_bp);
    lines.push(line({ key: 'transport.fuel', category: 'transport', description: `Fuel surcharge (${pctText(rates.shipping.fuel_surcharge_bp)})`, qty: 1, unit: 'each', unit_price_cents: fb, unit_cost_cents: fc, trace: `${pctText(rates.shipping.fuel_surcharge_bp)} of transport ${money(transportBill)} = ${money(fb)}.` }));
  }

  // 13. Manual lines.
  for (const m of input.manual_lines ?? []) {
    if (!m.client_visible && m.unit_price_cents !== 0) warnings.push(`Internal line “${m.description}” must have a price of 0 (clients only see visible lines).`);
    lines.push({
      key: `manual:${m.id}`,
      category: m.category,
      description: m.description,
      qty: m.qty,
      unit: m.unit,
      unit_price_cents: m.client_visible ? m.unit_price_cents : 0,
      unit_cost_cents: m.unit_cost_cents,
      amount_cents: m.client_visible ? lineAmount(m.qty, m.unit_price_cents) : 0,
      cost_cents: lineAmount(m.qty, m.unit_cost_cents),
      source: 'manual',
      client_visible: m.client_visible,
      overridden: false,
      trace: 'Entered by the estimator.',
    });
  }

  // 14. Rush premium.
  const preRush = lines.reduce((s, l) => s + l.amount_cents, 0);
  if (o.rush) {
    const p = rates.premiums;
    const bill = p.rush_mode === 'pct' ? applyBp(preRush, p.rush_bp) : p.rush_flat.bill;
    const cost = p.rush_mode === 'pct' ? 0 : p.rush_flat.cost;
    lines.push(line({ key: 'premium.rush', category: 'addons', description: p.rush_mode === 'pct' ? `Rush premium (${pctText(p.rush_bp)})` : 'Rush premium', qty: 1, unit: 'each', unit_price_cents: bill, unit_cost_cents: cost, trace: p.rush_mode === 'pct' ? `${pctText(p.rush_bp)} of ${money(preRush)} = ${money(bill)}.` : `Flat ${money(bill)}.` }));
  }

  // 15. Minimum job charge.
  let subtotal = lines.reduce((s, l) => s + l.amount_cents, 0);
  let minimumApplied = false;
  if (subtotal < rates.policy.min_job_charge) {
    const diff = rates.policy.min_job_charge - subtotal;
    lines.push(line({ key: 'policy.minimum', category: 'other', description: 'Minimum job charge adjustment', qty: 1, unit: 'each', unit_price_cents: diff, unit_cost_cents: 0, trace: `Lines total ${money(subtotal)}, under the ${money(rates.policy.min_job_charge)} minimum job charge → adds ${money(diff)}.` }));
    subtotal = rates.policy.min_job_charge;
    minimumApplied = true;
  }

  // 16. Discount, tax, totals.
  const discountBp = o.discount_bp ?? input.client_default_discount_bp ?? 0;
  const discount = applyBp(subtotal, discountBp);
  if (discount > 0) {
    lines.push({ key: 'discount', category: 'discount', description: `Discount (${pctText(discountBp)})`, qty: 1, unit: 'each', unit_price_cents: -discount, unit_cost_cents: 0, amount_cents: -discount, cost_cents: 0, source: 'calc', client_visible: true, overridden: false, trace: `${pctText(discountBp)} of ${money(subtotal)} = −${money(discount)}.` });
  }
  let tax = 0;
  if (rates.policy.tax_rate_bp > 0 && rates.policy.tax_categories.length) {
    const taxable = lines.filter((l) => rates.policy.tax_categories.includes(l.category)).reduce((s, l) => s + l.amount_cents, 0);
    const afterDiscount = taxable - applyBp(taxable, discountBp);
    tax = applyBp(afterDiscount, rates.policy.tax_rate_bp);
    if (tax > 0)
      lines.push({ key: 'tax', category: 'tax', description: `Tax (${pctText(rates.policy.tax_rate_bp)})`, qty: 1, unit: 'each', unit_price_cents: tax, unit_cost_cents: 0, amount_cents: tax, cost_cents: 0, source: 'calc', client_visible: true, overridden: false, trace: `${pctText(rates.policy.tax_rate_bp)} of taxable ${money(afterDiscount)} (${rates.policy.tax_categories.join(', ')}, after discount) = ${money(tax)}.` });
  }
  const cost = lines.reduce((s, l) => s + l.cost_cents, 0);
  const net = subtotal - discount;
  const margin = net - cost;
  const marginBp = net > 0 ? divRoundHalfUp(margin * 10_000, net) : 0;
  const belowTarget = marginBp < rates.policy.target_margin_bp;
  const approvalReasons: string[] = [];
  if (discountBp > rates.policy.discount_approval_threshold_bp)
    approvalReasons.push(`Discount ${pctText(discountBp)} is above the ${pctText(rates.policy.discount_approval_threshold_bp)} approval threshold.`);
  if (belowTarget) approvalReasons.push(`Margin ${pctText(marginBp)} is below the ${pctText(rates.policy.target_margin_bp)} target.`);

  return {
    lines,
    crew: { suggested, applied, reasons, overridden: !!o.crew_override, positions },
    packing,
    crates,
    distance: { total_miles: miles, tier_label: tier.label, multiplier_bp: tier.per_mile_multiplier_bp },
    billable_weight_lb: billable,
    required_equipment: [...required],
    totals: {
      subtotal_cents: subtotal,
      discount_bp: discountBp,
      discount_cents: discount,
      tax_cents: tax,
      total_cents: net + tax,
      cost_cents: cost,
      margin_cents: margin,
      margin_bp: marginBp,
    },
    flags: { needs_approval: approvalReasons.length > 0, approval_reasons: approvalReasons, below_target_margin: belowTarget, minimum_applied: minimumApplied },
    warnings,
  };
}

/** Only what a client may see: visible lines and totals (no costs, margins, traces). */
export function clientView(r: EstimateResult) {
  return {
    lines: r.lines
      .filter((l) => l.client_visible)
      .map((l) => ({ category: l.category, description: l.description, qty: l.qty, unit: l.unit, unit_price_cents: l.unit_price_cents, amount_cents: l.amount_cents })),
    totals: { subtotal_cents: r.totals.subtotal_cents, discount_cents: r.totals.discount_cents, tax_cents: r.totals.tax_cents, total_cents: r.totals.total_cents },
  };
}
