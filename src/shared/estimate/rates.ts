/**
 * Rate card schema. Every number that affects a price lives here (stored as JSONB on
 * public.rate_cards, validated by this schema in the browser and in the server
 * functions). Money is integer cents; percentages and multipliers are basis points
 * (10000 bp = 100% = 1.0×). Nothing in the engine is a hardcoded price.
 */
import * as z from 'zod/mini';

const cents = z.number().check(z.int(), z.gte(0), z.lte(100_000_000));
const bp = z.number().check(z.int(), z.gte(0), z.lte(100_000));
const pos = (max: number) => z.number().check(z.gt(0), z.lte(max));
const nonneg = (max: number) => z.number().check(z.gte(0), z.lte(max));
const billCost = z.object({ bill: cents, cost: cents });

export const CREW_POSITIONS = ['lead', 'driver', 'art_handler', 'crater', 'installer', 'other'] as const;
export const PACKING_METHODS = [
  'soft_pack', 'travel_frame', 'standard_crate', 'padded_crate', 'custom_crate', 'skid_bracing', 'double_boxed', 'rolled', 'flat_crate',
] as const;
export type PackingMethod = (typeof PACKING_METHODS)[number];
export const PACKING_LABEL: Record<PackingMethod, string> = {
  soft_pack: 'Soft pack',
  travel_frame: 'Travel frame',
  standard_crate: 'Standard crate',
  padded_crate: 'Padded crate',
  custom_crate: 'Custom crate',
  skid_bracing: 'Skid with blocking & bracing',
  double_boxed: 'Double-boxed crate',
  rolled: 'Rolled',
  flat_crate: 'Flat crate',
};
/** Methods that produce a wooden crate (materials takeoff + shop hours). */
export const CRATE_METHODS: PackingMethod[] = ['standard_crate', 'padded_crate', 'custom_crate', 'double_boxed', 'flat_crate', 'skid_bracing'];

export const ACCESS_KEYS = ['stairs_flight', 'no_dock', 'long_carry', 'no_freight_elevator', 'timed_access', 'security_checkin', 'coi'] as const;
export type AccessKey = (typeof ACCESS_KEYS)[number];
export const ADDON_KEYS = ['unpacking', 'placement', 'debris_removal', 'waiting_hour', 'storage_day', 'storage_cuft_month'] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];

const surcharge = z.object({
  label: z.string().check(z.minLength(1), z.maxLength(80)),
  /** flat = once per estimate; per_unit = × quantity entered (flights, items, hours…). */
  mode: z.enum(['flat', 'per_unit']),
  unit: z.string().check(z.maxLength(30)),
  bill: cents,
  cost: cents,
});

export const ratesSchema = z.object({
  schema_version: z.literal(1),
  currency: z.literal('USD'),
  labor: z.object({
    positions: z.object({
      lead: billCost,
      driver: billCost,
      art_handler: billCost,
      crater: billCost,
      installer: billCost,
      other: billCost,
    }),
    /** Hours per person per day before overtime. */
    overtime_after_hours: pos(24),
    overtime_multiplier_bp: bp,
    after_hours_multiplier_bp: bp,
    weekend_multiplier_bp: bp,
    min_hours_per_call: nonneg(24),
    /** Labor hours round up to this step (e.g. 0.25 = quarter hour). */
    hour_step: pos(4),
  }),
  vehicles: z.array(
    z.object({
      key: z.string().check(z.regex(/^[a-z0-9_]{2,40}$/)),
      label: z.string().check(z.minLength(1), z.maxLength(80)),
      asset_kind: z.enum(['truck', 'van', 'trailer']),
      per_hour: billCost,
      per_mile: billCost,
      minimum_bill: cents,
    }),
  ),
  equipment: z.array(
    z.object({
      key: z.string().check(z.regex(/^[a-z0-9_]{2,40}$/)),
      label: z.string().check(z.minLength(1), z.maxLength(80)),
      per_day: billCost,
    }),
  ),
  /** Ordered by up_to_miles; the multiplier applies to the per-mile vehicle rate. */
  distance_tiers: z.array(z.object({ label: z.string().check(z.maxLength(40)), up_to_miles: pos(100_000), per_mile_multiplier_bp: bp })),
  shipping: z.object({
    /** Cubic inches per pound (e.g. 250 → dim weight = L×W×H / 250). */
    dim_divisor: pos(10_000),
    /** Weight handling charge per 100 lb of billable weight. */
    per_cwt: billCost,
    padding_in: z.record(z.enum(PACKING_METHODS), nonneg(24)),
    oversize_max_side_in: pos(2000),
    oversize_sum_in: pos(5000),
    oversize_fee: billCost,
    fuel_surcharge_bp: bp,
  }),
  crating: z.object({
    /** Packing used when no packing rule matches the item's medium. */
    default_method: z.enum(PACKING_METHODS),
    /** Items at or above this weight count as "heavy" for packing rules. */
    heavy_item_lb: pos(100_000),
    /** Items whose largest side is at most this count as "small" for packing rules. */
    small_item_max_side_in: pos(5000),
    wall_thickness_in: nonneg(6),
    plywood_sheet: billCost,
    /** One sheet = 48 × 96 in. Waste allowance added to the area. */
    plywood_waste_bp: bp,
    lumber_per_lf: billCost,
    /** Linear feet of lumber per foot of crate edge (battens + skids). */
    lumber_factor_bp: bp,
    foam_per_bf: billCost,
    foam_thickness_in: nonneg(12),
    hardware_kit: billCost,
    paint_stencil: billCost,
    glassine_tissue: billCost,
    travel_frame_kit: billCost,
    soft_pack_kit: billCost,
    shop_labor_per_hour: billCost,
    /** Size classes by the crate's largest outer side; ordered by max_side_in. */
    size_classes: z.array(z.object({ label: z.string().check(z.maxLength(30)), max_side_in: pos(5000), shop_hours: nonneg(200) })),
  }),
  removal: z.object({
    /** Install / de-install labor hours per item by weight band (ordered). */
    hours_by_weight: z.array(z.object({ up_to_lb: pos(100_000), hours: nonneg(100) })),
    /** Equipment needed when an item exceeds a weight or height. */
    equipment_rules: z.array(
      z.object({ equipment_key: z.string().check(z.regex(/^[a-z0-9_]{2,40}$/)), min_weight_lb: nonneg(100_000), min_height_in: nonneg(5000) }),
    ),
  }),
  insurance: z.object({ pct_bp: bp, cost_pct_bp: bp, minimum: cents }),
  access: z.record(z.enum(ACCESS_KEYS), surcharge),
  addons: z.record(z.enum(ADDON_KEYS), surcharge),
  premiums: z.object({
    rush_mode: z.enum(['pct', 'flat']),
    rush_bp: bp,
    rush_flat: billCost,
  }),
  policy: z.object({
    min_job_charge: cents,
    target_margin_bp: bp,
    discount_approval_threshold_bp: bp,
    quote_validity_days: z.number().check(z.int(), z.gte(1), z.lte(365)),
    tax_rate_bp: bp,
    tax_categories: z.array(z.string()),
  }),
});
export type Rates = z.infer<typeof ratesSchema>;

/**
 * SAMPLE rate card. Every value is a placeholder: replace with your own rates.
 * The estimates area shows a banner until an admin marks the active card reviewed.
 */
export const SAMPLE_RATES: Rates = {
  schema_version: 1,
  currency: 'USD',
  labor: {
    positions: {
      lead: { bill: 9500, cost: 4800 },
      driver: { bill: 8500, cost: 4200 },
      art_handler: { bill: 8000, cost: 3800 },
      crater: { bill: 8500, cost: 4000 },
      installer: { bill: 9000, cost: 4500 },
      other: { bill: 7000, cost: 3200 },
    },
    overtime_after_hours: 8,
    overtime_multiplier_bp: 15_000,
    after_hours_multiplier_bp: 12_500,
    weekend_multiplier_bp: 15_000,
    min_hours_per_call: 4,
    hour_step: 0.25,
  },
  vehicles: [
    { key: 'truck_air_ride_climate', label: 'Air-ride climate truck', asset_kind: 'truck', per_hour: { bill: 9500, cost: 4500 }, per_mile: { bill: 450, cost: 220 }, minimum_bill: 40000 },
    { key: 'truck_air_ride', label: 'Air-ride truck', asset_kind: 'truck', per_hour: { bill: 8000, cost: 3800 }, per_mile: { bill: 400, cost: 200 }, minimum_bill: 32000 },
    { key: 'van_liftgate', label: 'Liftgate van', asset_kind: 'van', per_hour: { bill: 6000, cost: 2800 }, per_mile: { bill: 250, cost: 120 }, minimum_bill: 24000 },
  ],
  equipment: [
    { key: 'gantry', label: 'Gantry', per_day: { bill: 45000, cost: 20000 } },
    { key: 'lift', label: 'Lift', per_day: { bill: 35000, cost: 15000 } },
    { key: 'pallet_jack', label: 'Pallet jack', per_day: { bill: 6000, cost: 1500 } },
    { key: 'rigging_kit', label: 'Rigging kit', per_day: { bill: 15000, cost: 5000 } },
    { key: 'panel_cart', label: 'Panel cart', per_day: { bill: 4000, cost: 1000 } },
    { key: 'a_frame', label: 'A-frame', per_day: { bill: 4000, cost: 1000 } },
  ],
  distance_tiers: [
    { label: 'Local', up_to_miles: 50, per_mile_multiplier_bp: 10_000 },
    { label: 'Regional', up_to_miles: 300, per_mile_multiplier_bp: 9_000 },
    { label: 'Long-haul', up_to_miles: 100_000, per_mile_multiplier_bp: 8_000 },
  ],
  shipping: {
    dim_divisor: 250,
    per_cwt: { bill: 1800, cost: 600 },
    padding_in: { soft_pack: 2, travel_frame: 3, standard_crate: 3, padded_crate: 4, custom_crate: 4, skid_bracing: 6, double_boxed: 5, rolled: 2, flat_crate: 3 },
    oversize_max_side_in: 96,
    oversize_sum_in: 180,
    oversize_fee: { bill: 25000, cost: 8000 },
    fuel_surcharge_bp: 800,
  },
  crating: {
    default_method: 'standard_crate',
    heavy_item_lb: 200,
    small_item_max_side_in: 24,
    wall_thickness_in: 0.75,
    plywood_sheet: { bill: 9500, cost: 5200 },
    plywood_waste_bp: 1_500,
    lumber_per_lf: { bill: 350, cost: 150 },
    lumber_factor_bp: 20_000,
    foam_per_bf: { bill: 450, cost: 180 },
    foam_thickness_in: 2,
    hardware_kit: { bill: 4500, cost: 1500 },
    paint_stencil: { bill: 3000, cost: 800 },
    glassine_tissue: { bill: 1500, cost: 400 },
    travel_frame_kit: { bill: 12000, cost: 4500 },
    soft_pack_kit: { bill: 3500, cost: 1000 },
    shop_labor_per_hour: { bill: 8500, cost: 4000 },
    size_classes: [
      { label: 'Small', max_side_in: 36, shop_hours: 2 },
      { label: 'Medium', max_side_in: 60, shop_hours: 4 },
      { label: 'Large', max_side_in: 96, shop_hours: 6 },
      { label: 'Oversize', max_side_in: 5000, shop_hours: 10 },
    ],
  },
  removal: {
    hours_by_weight: [
      { up_to_lb: 50, hours: 1 },
      { up_to_lb: 200, hours: 2 },
      { up_to_lb: 500, hours: 3 },
      { up_to_lb: 1000, hours: 5 },
      { up_to_lb: 100_000, hours: 8 },
    ],
    equipment_rules: [
      { equipment_key: 'pallet_jack', min_weight_lb: 300, min_height_in: 0 },
      { equipment_key: 'gantry', min_weight_lb: 800, min_height_in: 0 },
      { equipment_key: 'lift', min_weight_lb: 0, min_height_in: 120 },
    ],
  },
  insurance: { pct_bp: 100, cost_pct_bp: 60, minimum: 5000 },
  access: {
    stairs_flight: { label: 'Stairs (per flight)', mode: 'per_unit', unit: 'flight', bill: 7500, cost: 2500 },
    no_dock: { label: 'No loading dock', mode: 'flat', unit: '', bill: 10000, cost: 3500 },
    long_carry: { label: 'Long carry (per 50 ft over 100 ft)', mode: 'per_unit', unit: '50 ft', bill: 5000, cost: 1800 },
    no_freight_elevator: { label: 'No freight elevator', mode: 'flat', unit: '', bill: 15000, cost: 5000 },
    timed_access: { label: 'Timed / restricted access', mode: 'flat', unit: '', bill: 7500, cost: 2500 },
    security_checkin: { label: 'Security check-in', mode: 'flat', unit: '', bill: 5000, cost: 1500 },
    coi: { label: 'COI processing', mode: 'flat', unit: '', bill: 7500, cost: 1000 },
  },
  addons: {
    unpacking: { label: 'Unpacking (per item)', mode: 'per_unit', unit: 'item', bill: 4000, cost: 1500 },
    placement: { label: 'Placement / installation (per item)', mode: 'per_unit', unit: 'item', bill: 7500, cost: 3000 },
    debris_removal: { label: 'Debris and packing removal', mode: 'flat', unit: '', bill: 12500, cost: 5000 },
    waiting_hour: { label: 'Waiting time (per hour)', mode: 'per_unit', unit: 'hour', bill: 15000, cost: 7500 },
    storage_day: { label: 'Temporary storage (per item per day)', mode: 'per_unit', unit: 'item-day', bill: 1500, cost: 500 },
    storage_cuft_month: { label: 'Storage (per cu ft per month)', mode: 'per_unit', unit: 'cu ft-month', bill: 200, cost: 70 },
  },
  premiums: { rush_mode: 'pct', rush_bp: 2_500, rush_flat: { bill: 25000, cost: 0 } },
  policy: {
    min_job_charge: 45000,
    target_margin_bp: 3_500,
    discount_approval_threshold_bp: 1_000,
    quote_validity_days: 30,
    tax_rate_bp: 0,
    tax_categories: [],
  },
};

// ── Editable rule tables (stored in their own tables, copied into each snapshot) ──

export const packingRuleSchema = z.object({
  /** Free-text medium keyword matched case-insensitively against the item's medium. */
  medium_match: z.string().check(z.minLength(1), z.maxLength(80)),
  /** Optional condition: glazed/framed works, heavy items, or long-haul trips. */
  condition: z.enum(['any', 'local', 'long_haul', 'glazed', 'heavy', 'small']),
  method: z.enum(PACKING_METHODS),
  note: z.string().check(z.maxLength(200)),
  position: z.number().check(z.int()),
});
export type PackingRule = z.infer<typeof packingRuleSchema>;

export const CREW_RULE_KINDS = ['base', 'min_if_flat_over_sqft', 'add_per_weight_band', 'min_if_flag', 'add_if_access', 'equipment_over_weight'] as const;
export const crewRuleSchema = z.object({
  kind: z.enum(CREW_RULE_KINDS),
  /** base / min_*: crew count; add_*: people added. */
  crew: z.number().check(z.int(), z.gte(0), z.lte(20)),
  /** sq ft (flat), lb band (weight), flag key, access key, or lb (equipment). */
  param: z.string().check(z.maxLength(60)),
  equipment_key: z.optional(z.string()),
  note: z.string().check(z.maxLength(200)),
  position: z.number().check(z.int()),
});
export type CrewRule = z.infer<typeof crewRuleSchema>;

export const SAMPLE_PACKING_RULES: PackingRule[] = [
  { medium_match: 'canvas', condition: 'local', method: 'soft_pack', note: 'Oil/acrylic on canvas, local: soft pack', position: 1 },
  { medium_match: 'canvas', condition: 'long_haul', method: 'travel_frame', note: 'Oil/acrylic on canvas, long-haul: travel frame', position: 2 },
  { medium_match: 'paper', condition: 'glazed', method: 'padded_crate', note: 'Works on paper, framed and glazed: crate with glazing protection', position: 3 },
  { medium_match: 'paper', condition: 'any', method: 'soft_pack', note: 'Unframed works on paper: soft pack in glassine', position: 4 },
  { medium_match: 'photograph', condition: 'any', method: 'standard_crate', note: 'Mounted photography: crate', position: 5 },
  { medium_match: 'sculpture', condition: 'heavy', method: 'skid_bracing', note: 'Large/heavy sculpture: skid with blocking and bracing', position: 6 },
  { medium_match: 'sculpture', condition: 'any', method: 'padded_crate', note: 'Small sculpture: padded crate', position: 7 },
  { medium_match: 'bronze', condition: 'heavy', method: 'skid_bracing', note: 'Heavy bronze: skid with blocking and bracing', position: 8 },
  { medium_match: 'ceramic', condition: 'any', method: 'double_boxed', note: 'Ceramics: double-boxed crate', position: 9 },
  { medium_match: 'glass', condition: 'any', method: 'double_boxed', note: 'Glass objects: double-boxed crate', position: 10 },
  { medium_match: 'textile', condition: 'any', method: 'rolled', note: 'Textiles: rolled (or flat crate if fragile)', position: 11 },
];

export const SAMPLE_CREW_RULES: CrewRule[] = [
  { kind: 'base', crew: 2, param: '', note: 'Every move starts with two people', position: 1 },
  { kind: 'min_if_flat_over_sqft', crew: 2, param: '9', note: 'At least 2 for 2D works over 3 × 3 ft', position: 2 },
  { kind: 'add_per_weight_band', crew: 1, param: '250', note: '+1 per 250 lb of the heaviest item', position: 3 },
  { kind: 'min_if_flag', crew: 2, param: 'two_person', note: 'At least 2 for two-person items', position: 4 },
  { kind: 'add_if_access', crew: 1, param: 'stairs_flight', note: '+1 for stairs', position: 5 },
  { kind: 'add_if_access', crew: 1, param: 'long_carry', note: '+1 for a long carry', position: 6 },
  { kind: 'equipment_over_weight', crew: 0, param: '300', equipment_key: 'pallet_jack', note: 'Pallet jack over 300 lb', position: 7 },
];
