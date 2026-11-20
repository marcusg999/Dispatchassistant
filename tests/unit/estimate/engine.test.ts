/**
 * Estimate engine: golden files (every line and total to the cent), hand-calculated
 * checks, and property tests. Update golden files deliberately with:
 *   npx vitest run --project unit tests/unit/estimate -u
 * then review the diff line by line.
 */
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_CREW_RULES,
  SAMPLE_PACKING_RULES,
  SAMPLE_RATES,
  applyBp,
  clientView,
  computeEstimate,
  divRoundHalfUp,
  lineAmount,
  ratesSchema,
  type RateSnapshot,
  type Rates,
} from '../../../src/shared/estimate';
import { FIXTURES } from './fixtures';

const snap = (rates: Rates = SAMPLE_RATES): RateSnapshot => ({ rates, packing_rules: SAMPLE_PACKING_RULES, crew_rules: SAMPLE_CREW_RULES });
const withTax = (): Rates => ({ ...SAMPLE_RATES, policy: { ...SAMPLE_RATES.policy, tax_rate_bp: 950, tax_categories: ['packing_crating'] } });
const run = (name: string) => computeEstimate(FIXTURES[name], name === 'tax_on_packing' ? snap(withTax()) : snap());

const golden = (name: string) => {
  const r = run(name);
  return {
    lines: r.lines.map((l) => ({ key: l.key, category: l.category, qty: l.qty, unit_price: l.unit_price_cents, amount: l.amount_cents, cost: l.cost_cents, visible: l.client_visible, overridden: l.overridden })),
    totals: r.totals,
    crew: { suggested: r.crew.suggested, applied: r.crew.applied, positions: r.crew.positions },
    flags: r.flags,
    distance: r.distance,
    billable_weight_lb: r.billable_weight_lb,
    crates: r.crates.map((c) => ({ item: c.item_id, method: c.method, outer: c.outer_in, sheets: c.plywood_sheets, lf: c.lumber_lf, bf: c.foam_bf, cls: c.size_class, hours: c.shop_hours })),
    warnings: r.warnings,
  };
};

describe('money', () => {
  it('rounds half-up at the cent', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 2)).toBe(2);
    expect(divRoundHalfUp(149, 100)).toBe(1);
    expect(divRoundHalfUp(150, 100)).toBe(2);
    expect(divRoundHalfUp(-150, 100)).toBe(-2);
    expect(lineAmount(1.29, 1800)).toBe(2322);
    expect(lineAmount(380.5, 360)).toBe(136980);
    expect(applyBp(224802, 800)).toBe(17984); // 17984.16
    expect(applyBp(1, 5000)).toBe(1); // 0.5 → 1
    expect(() => lineAmount(1.234, 100)).toThrow();
  });
});

describe('sample rate card', () => {
  it('validates against the schema', () => {
    expect(ratesSchema.safeParse(SAMPLE_RATES).success).toBe(true);
  });
});

describe('golden fixtures', () => {
  const names = Object.keys(FIXTURES);
  it('has at least 15 fixtures', () => expect(names.length).toBeGreaterThanOrEqual(15));
  for (const name of names) {
    it(name, async () => {
      await expect(JSON.stringify(golden(name), null, 2)).toMatchFileSnapshot(`./golden/${name}.json`);
    });
  }
});

describe('hand-calculated checks', () => {
  it('long-haul crate: dimensional weight, tiered mileage, fuel, stairs crew', () => {
    const r = run('long_haul_crate');
    const by = (k: string) => r.lines.find((l) => l.key === k)!;
    // custom crate padding 4 + wall 0.75 per side: 69.5 × 57.5 × 12.5 = 49,953.125 cu in ÷ 250 = 199.8 → 200 lb
    expect(r.billable_weight_lb).toBe(200);
    expect(by('shipping.weight').amount_cents).toBe(3600); // 2.00 cwt × $18
    expect(by('transport.miles').unit_price_cents).toBe(360); // $4.50 × 80%
    expect(by('transport.miles').amount_cents).toBe(136980);
    expect(r.crew.applied).toBe(3); // base 2 + stairs
    expect(r.crew.positions).toEqual({ driver: 1, lead: 1, art_handler: 1 });
    expect(by('labor_ot:lead').unit_price_cents).toBe(14250); // $95 × 1.5
    expect(by('insurance').amount_cents).toBe(120000); // 1% of $120,000
    const crate = r.crates[0];
    expect(crate.outer_in).toEqual([69.5, 57.5, 12.5]);
    expect(crate.size_class).toBe('Large');
  });

  it('minimum job charge lifts a tiny job to the floor', () => {
    const r = run('minimum_charge_floor');
    expect(r.flags.minimum_applied).toBe(true);
    expect(r.totals.subtotal_cents).toBe(SAMPLE_RATES.policy.min_job_charge);
    const adj = r.lines.find((l) => l.key === 'policy.minimum')!;
    const others = r.lines.filter((l) => l.key !== 'policy.minimum').reduce((s, l) => s + l.amount_cents, 0);
    expect(adj.amount_cents).toBe(SAMPLE_RATES.policy.min_job_charge - others);
  });

  it('discount above the threshold needs approval; client default under it does not', () => {
    const a = run('discount_needs_approval');
    expect(a.totals.discount_bp).toBe(1500);
    expect(a.flags.needs_approval).toBe(true);
    expect(a.flags.approval_reasons[0]).toMatch(/approval threshold/);
    expect(a.totals.discount_cents).toBe(applyBp(a.totals.subtotal_cents, 1500));
    const b = run('client_default_discount_ok');
    expect(b.totals.discount_bp).toBe(500);
    expect(b.flags.approval_reasons.some((x) => /threshold/.test(x))).toBe(false);
  });

  it('tax applies only to the chosen categories, after discount', () => {
    const on = run('tax_on_packing');
    const off = run('tax_off');
    const packing = on.lines.filter((l) => l.category === 'packing_crating').reduce((s, l) => s + l.amount_cents, 0);
    expect(on.totals.tax_cents).toBe(applyBp(packing, 950));
    expect(on.totals.total_cents).toBe(off.totals.total_cents + on.totals.tax_cents);
    expect(off.totals.tax_cents).toBe(0);
    expect(off.lines.some((l) => l.key === 'tax')).toBe(false);
  });

  it('heavy sculpture removal adds gantry + pallet jack and install hours', () => {
    const r = run('heavy_sculpture_removal_gantry');
    expect(r.required_equipment.sort()).toEqual(['gantry', 'pallet_jack']);
    expect(r.lines.some((l) => l.key === 'equipment:gantry')).toBe(true);
    expect(r.crew.applied).toBe(5); // base 2 + floor(950/250)=3
    expect(r.packing[0].chosen).toBe('skid_bracing'); // heavy bronze rule
  });

  it('overrides keep the original and require a reason; internal lines carry no price', () => {
    const r = run('manual_line_and_override');
    const v = r.lines.find((l) => l.key === 'transport.vehicle_time')!;
    expect(v.overridden).toBe(true);
    expect(v.original!.unit_price_cents).toBe(6000);
    expect(v.unit_price_cents).toBe(5500);
    const tip = r.lines.find((l) => l.key === 'manual:tip')!;
    expect(tip.amount_cents).toBe(0);
    expect(tip.cost_cents).toBe(4000);
    expect(clientView(r).lines.some((l) => l.description.includes('internal'))).toBe(false);
  });

  it('after-hours multiplier and rush premium', () => {
    const r = run('after_hours_rush');
    expect(r.lines.find((l) => l.key === 'labor:driver')!.unit_price_cents).toBe(applyBp(8500, 12_500));
    expect(r.lines.some((l) => l.key === 'premium.rush')).toBe(true);
  });
});

describe('properties', () => {
  for (const name of Object.keys(FIXTURES)) {
    it(`${name}: totals equal the lines, nothing negative, deterministic`, () => {
      const r = run(name);
      const sumAll = r.lines.reduce((s, l) => s + l.amount_cents, 0);
      expect(sumAll).toBe(r.totals.total_cents);
      expect(r.lines.reduce((s, l) => s + l.cost_cents, 0)).toBe(r.totals.cost_cents);
      expect(r.totals.total_cents).toBeGreaterThan(0);
      for (const l of r.lines) {
        expect(Number.isInteger(l.amount_cents)).toBe(true);
        if (l.category !== 'discount') expect(l.amount_cents).toBeGreaterThanOrEqual(0);
        expect(l.amount_cents).toBe(lineAmount(l.qty, l.unit_price_cents));
      }
      // Client view adds up too (internal lines have no price).
      const cv = clientView(r);
      expect(cv.lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(cv.totals.total_cents);
      expect(JSON.stringify(run(name))).toBe(JSON.stringify(r));
    });
  }

  it('a rate snapshot isolates an old estimate from later rate edits', () => {
    const frozen = structuredClone(SAMPLE_RATES);
    const before = computeEstimate(FIXTURES.long_haul_crate, snap(frozen));
    const edited: Rates = structuredClone(SAMPLE_RATES);
    edited.vehicles[0].per_mile.bill = 999;
    const after = computeEstimate(FIXTURES.long_haul_crate, snap(edited));
    expect(after.totals.total_cents).not.toBe(before.totals.total_cents);
    expect(computeEstimate(FIXTURES.long_haul_crate, snap(frozen)).totals).toEqual(before.totals);
  });
});
