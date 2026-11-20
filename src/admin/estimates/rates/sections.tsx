/** The rate card editor's form sections: one per part of the rate card schema. */
import type { ReactNode } from 'react';
import { ACCESS_KEYS, ADDON_KEYS, CREW_POSITIONS, LINE_CATEGORIES, LINE_CATEGORY_LABEL, PACKING_LABEL, PACKING_METHODS } from '../../../shared/estimate';
import { getAt, same } from './diff';
import { Group, NumberField, RemoveCell, RowTable, SelectField, TextField, useEditor } from './fields';

const POSITION_LABEL: Record<string, string> = {
  lead: 'Lead',
  driver: 'Driver',
  art_handler: 'Art handler',
  crater: 'Crater',
  installer: 'Installer',
  other: 'Other crew',
};
const PACKING_OPTIONS = PACKING_METHODS.map((m) => ({ value: m, label: PACKING_LABEL[m] }));
const MODE_OPTIONS = [
  { value: 'flat', label: 'Flat (once per estimate)' },
  { value: 'per_unit', label: 'Per unit (times quantity)' },
];

export const SECTION_IDS: { id: string; title: string }[] = [
  { id: 'labor', title: 'Labor' },
  { id: 'vehicles', title: 'Vehicles' },
  { id: 'equipment', title: 'Equipment' },
  { id: 'distance', title: 'Distance tiers' },
  { id: 'shipping', title: 'Shipping' },
  { id: 'crating', title: 'Crating & packing' },
  { id: 'removal', title: 'Install & removal' },
  { id: 'insurance', title: 'Insurance' },
  { id: 'surcharges', title: 'Access & add-ons' },
  { id: 'premiums', title: 'Premiums' },
  { id: 'policy', title: 'Policy' },
];

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} className="a-panel scroll-mt-24 p-5" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg font-bold">
        {title}
      </h2>
      {intro && <p className="mt-1 max-w-3xl text-muted">{intro}</p>}
      {children}
    </section>
  );
}

/** Marker under a table when the row count differs from the active card. */
function useRowNote(path: string): string | null {
  const { draft, base } = useEditor();
  if (!base) return null;
  const a = (getAt(draft, path) as unknown[]) ?? [];
  const b = (getAt(base, path) as unknown[]) ?? [];
  return a.length === b.length ? null : `${a.length} rows here, ${b.length} on the active card`;
}

function uniqueKey(existing: string[], stem: string): string {
  let n = existing.length + 1;
  while (existing.includes(`${stem}_${n}`)) n++;
  return `${stem}_${n}`;
}

function LaborSection() {
  return (
    <Section id="labor" title="Labor" intro="Hourly rates per crew position. Bill is what the client pays; cost is what it costs you.">
      <RowTable caption="Labor rates by position" headers={['Position', 'Bill rate ($ per hour)', 'Cost rate ($ per hour)']}>
        {CREW_POSITIONS.map((p) => (
          <tr key={p}>
            <th scope="row" className="text-left font-semibold">{POSITION_LABEL[p]}</th>
            <td><NumberField compact kind="cents" unit="per hour" path={`labor.positions.${p}.bill`} label={`${POSITION_LABEL[p]} bill rate`} /></td>
            <td><NumberField compact kind="cents" unit="per hour" path={`labor.positions.${p}.cost`} label={`${POSITION_LABEL[p]} cost rate`} /></td>
          </tr>
        ))}
      </RowTable>
      <Group title="Overtime, premiums and rounding">
        <NumberField kind="num" unit="hours per person per day" path="labor.overtime_after_hours" label="Overtime starts after" />
        <NumberField kind="mult" unit="of the normal rate" path="labor.overtime_multiplier_bp" label="Overtime multiplier" help="1.5 means time and a half." />
        <NumberField kind="mult" unit="of the normal rate" path="labor.after_hours_multiplier_bp" label="After-hours multiplier" />
        <NumberField kind="mult" unit="of the normal rate" path="labor.weekend_multiplier_bp" label="Weekend multiplier" />
        <NumberField kind="num" unit="hours per call" path="labor.min_hours_per_call" label="Minimum hours" />
        <NumberField kind="num" unit="hours" path="labor.hour_step" label="Round hours up to" help="0.25 rounds up to the next quarter hour." />
      </Group>
    </Section>
  );
}

function VehiclesSection() {
  const { draft, mutate, editable } = useEditor();
  const note = useRowNote('vehicles');
  return (
    <Section id="vehicles" title="Vehicles" intro="Each vehicle has an hourly rate, a per-mile rate and a minimum charge. The key is used by saved estimates and must be lowercase letters, numbers and underscores.">
      <RowTable
        caption="Vehicles"
        note={note}
        headers={['Key', 'Name', 'Type', 'Bill ($ per hour)', 'Cost ($ per hour)', 'Bill ($ per mile)', 'Cost ($ per mile)', 'Minimum charge ($)']}
        addLabel="Add vehicle"
        onAdd={() =>
          mutate((d) =>
            d.vehicles.push({
              key: uniqueKey(d.vehicles.map((v) => v.key), 'vehicle'),
              label: 'New vehicle',
              asset_kind: 'truck',
              per_hour: { bill: 0, cost: 0 },
              per_mile: { bill: 0, cost: 0 },
              minimum_bill: 0,
            }),
          )
        }
      >
        {draft.vehicles.map((_, i) => {
          const n = `Vehicle ${i + 1}`;
          return (
            <tr key={i}>
              <td><TextField compact width="w-44" path={`vehicles.${i}.key`} label={`${n} key`} maxLength={40} /></td>
              <td><TextField compact width="w-44" path={`vehicles.${i}.label`} label={`${n} name`} maxLength={80} /></td>
              <td>
                <SelectField compact width="w-28" path={`vehicles.${i}.asset_kind`} label={`${n} type`} options={['truck', 'van', 'trailer'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))} />
              </td>
              <td><NumberField compact width="w-24" kind="cents" unit="/h" path={`vehicles.${i}.per_hour.bill`} label={`${n} bill per hour`} /></td>
              <td><NumberField compact width="w-24" kind="cents" unit="/h" path={`vehicles.${i}.per_hour.cost`} label={`${n} cost per hour`} /></td>
              <td><NumberField compact width="w-24" kind="cents" unit="/mi" path={`vehicles.${i}.per_mile.bill`} label={`${n} bill per mile`} /></td>
              <td><NumberField compact width="w-24" kind="cents" unit="/mi" path={`vehicles.${i}.per_mile.cost`} label={`${n} cost per mile`} /></td>
              <td><NumberField compact width="w-24" kind="cents" path={`vehicles.${i}.minimum_bill`} label={`${n} minimum charge`} /></td>
              <RemoveCell label={n} onRemove={() => mutate((d) => d.vehicles.splice(i, 1))} />
            </tr>
          );
        })}
      </RowTable>
      {editable && draft.vehicles.length === 0 && <p className="mt-2 text-muted">No vehicles yet: estimates will have no transport line.</p>}
    </Section>
  );
}

function EquipmentSection() {
  const { draft, mutate } = useEditor();
  const note = useRowNote('equipment');
  return (
    <Section id="equipment" title="Equipment" intro="Daily rental rates for gantries, lifts and other gear.">
      <RowTable
        caption="Equipment"
        note={note}
        headers={['Key', 'Name', 'Bill ($ per day)', 'Cost ($ per day)']}
        addLabel="Add equipment"
        onAdd={() => mutate((d) => d.equipment.push({ key: uniqueKey(d.equipment.map((e) => e.key), 'equipment'), label: 'New equipment', per_day: { bill: 0, cost: 0 } }))}
      >
        {draft.equipment.map((_, i) => {
          const n = `Equipment ${i + 1}`;
          return (
            <tr key={i}>
              <td><TextField compact width="w-44" path={`equipment.${i}.key`} label={`${n} key`} maxLength={40} /></td>
              <td><TextField compact width="w-52" path={`equipment.${i}.label`} label={`${n} name`} maxLength={80} /></td>
              <td><NumberField compact kind="cents" unit="/day" path={`equipment.${i}.per_day.bill`} label={`${n} bill per day`} /></td>
              <td><NumberField compact kind="cents" unit="/day" path={`equipment.${i}.per_day.cost`} label={`${n} cost per day`} /></td>
              <RemoveCell label={n} onRemove={() => mutate((d) => d.equipment.splice(i, 1))} />
            </tr>
          );
        })}
      </RowTable>
    </Section>
  );
}

function DistanceSection() {
  const { draft, mutate } = useEditor();
  const note = useRowNote('distance_tiers');
  return (
    <Section id="distance" title="Distance tiers" intro="Keep tiers in order from shortest to longest. The multiplier scales the vehicle's per-mile rate for trips up to that distance.">
      <RowTable
        caption="Distance tiers"
        note={note}
        headers={['Name', 'Up to (miles)', 'Per-mile multiplier (×)']}
        addLabel="Add tier"
        onAdd={() => mutate((d) => d.distance_tiers.push({ label: 'New tier', up_to_miles: 1000, per_mile_multiplier_bp: 10000 }))}
      >
        {draft.distance_tiers.map((_, i) => {
          const n = `Tier ${i + 1}`;
          return (
            <tr key={i}>
              <td><TextField compact width="w-44" path={`distance_tiers.${i}.label`} label={`${n} name`} maxLength={40} /></td>
              <td><NumberField compact kind="num" unit="mi" path={`distance_tiers.${i}.up_to_miles`} label={`${n} up to miles`} /></td>
              <td><NumberField compact kind="mult" path={`distance_tiers.${i}.per_mile_multiplier_bp`} label={`${n} per-mile multiplier`} /></td>
              <RemoveCell label={n} onRemove={() => mutate((d) => d.distance_tiers.splice(i, 1))} />
            </tr>
          );
        })}
      </RowTable>
    </Section>
  );
}

function ShippingSection() {
  return (
    <Section id="shipping" title="Shipping" intro="Weight-based handling for shipped work: dimensional weight, handling per 100 lb, packing padding, oversize rules and fuel.">
      <Group>
        <NumberField kind="num" unit="cubic inches per pound" path="shipping.dim_divisor" label="Dimensional weight divisor" help="Cubic inches per pound. Dim weight = length × width × height ÷ this number." />
        <NumberField kind="cents" unit="per 100 lb (bill)" path="shipping.per_cwt.bill" label="Weight handling, bill" />
        <NumberField kind="cents" unit="per 100 lb (cost)" path="shipping.per_cwt.cost" label="Weight handling, cost" />
        <NumberField kind="pct" unit="of shipping charges" path="shipping.fuel_surcharge_bp" label="Fuel surcharge" />
      </Group>
      <Group title="Padding added to each side by packing method">
        {PACKING_METHODS.map((m) => (
          <NumberField key={m} kind="num" unit="inches" path={`shipping.padding_in.${m}`} label={PACKING_LABEL[m]} />
        ))}
      </Group>
      <Group title="Oversize">
        <NumberField kind="num" unit="inches (longest side)" path="shipping.oversize_max_side_in" label="Oversize when a side exceeds" />
        <NumberField kind="num" unit="inches (length + width + height)" path="shipping.oversize_sum_in" label="Oversize when the sum exceeds" />
        <NumberField kind="cents" unit="per piece (bill)" path="shipping.oversize_fee.bill" label="Oversize fee, bill" />
        <NumberField kind="cents" unit="per piece (cost)" path="shipping.oversize_fee.cost" label="Oversize fee, cost" />
      </Group>
    </Section>
  );
}

const MATERIALS: { key: string; label: string; unit: string }[] = [
  { key: 'plywood_sheet', label: 'Plywood sheet', unit: 'per sheet' },
  { key: 'lumber_per_lf', label: 'Lumber', unit: 'per linear foot' },
  { key: 'foam_per_bf', label: 'Foam', unit: 'per board foot' },
  { key: 'hardware_kit', label: 'Hardware kit', unit: 'per crate' },
  { key: 'paint_stencil', label: 'Paint and stencil', unit: 'per crate' },
  { key: 'glassine_tissue', label: 'Glassine and tissue', unit: 'per item' },
  { key: 'travel_frame_kit', label: 'Travel frame kit', unit: 'per item' },
  { key: 'soft_pack_kit', label: 'Soft pack kit', unit: 'per item' },
  { key: 'shop_labor_per_hour', label: 'Shop labor', unit: 'per hour' },
];

function CratingSection() {
  const { draft, mutate } = useEditor();
  const note = useRowNote('crating.size_classes');
  return (
    <Section id="crating" title="Crating & packing" intro="Materials and shop time used to price crates, plus the thresholds the packing rules use.">
      <Group title="Defaults and thresholds">
        <SelectField path="crating.default_method" label="Default packing method" options={PACKING_OPTIONS} help="Used when no packing rule matches the item." />
        <NumberField kind="num" unit="lb" path="crating.heavy_item_lb" label="Heavy item at or above" />
        <NumberField kind="num" unit="inches (largest side)" path="crating.small_item_max_side_in" label="Small item up to" />
      </Group>
      <Group title="Crate construction">
        <NumberField kind="num" unit="inches" path="crating.wall_thickness_in" label="Wall thickness" />
        <NumberField kind="pct" unit="added to plywood area" path="crating.plywood_waste_bp" label="Plywood waste allowance" help="One sheet is 48 × 96 inches." />
        <NumberField kind="mult" unit="ft lumber per ft of crate edge" path="crating.lumber_factor_bp" label="Lumber factor" help="Battens plus skids." />
        <NumberField kind="num" unit="inches" path="crating.foam_thickness_in" label="Foam thickness" />
      </Group>
      <RowTable caption="Crating materials and shop labor" headers={['Material', 'Unit', 'Bill ($)', 'Cost ($)']}>
        {MATERIALS.map((m) => (
          <tr key={m.key}>
            <th scope="row" className="text-left font-semibold">{m.label}</th>
            <td className="text-muted">{m.unit}</td>
            <td><NumberField compact kind="cents" path={`crating.${m.key}.bill`} label={`${m.label} bill ${m.unit}`} /></td>
            <td><NumberField compact kind="cents" path={`crating.${m.key}.cost`} label={`${m.label} cost ${m.unit}`} /></td>
          </tr>
        ))}
      </RowTable>
      <RowTable
        caption="Crate size classes"
        note={note}
        headers={['Name', 'Largest outer side up to (inches)', 'Shop hours (hours)']}
        addLabel="Add size class"
        onAdd={() => mutate((d) => d.crating.size_classes.push({ label: 'New class', max_side_in: 120, shop_hours: 8 }))}
      >
        {draft.crating.size_classes.map((_, i) => {
          const n = `Size class ${i + 1}`;
          return (
            <tr key={i}>
              <td><TextField compact width="w-44" path={`crating.size_classes.${i}.label`} label={`${n} name`} maxLength={30} /></td>
              <td><NumberField compact kind="num" unit="in" path={`crating.size_classes.${i}.max_side_in`} label={`${n} largest side up to`} /></td>
              <td><NumberField compact kind="num" unit="h" path={`crating.size_classes.${i}.shop_hours`} label={`${n} shop hours`} /></td>
              <RemoveCell label={n} onRemove={() => mutate((d) => d.crating.size_classes.splice(i, 1))} />
            </tr>
          );
        })}
      </RowTable>
    </Section>
  );
}

function RemovalSection() {
  const { draft, mutate } = useEditor();
  const noteH = useRowNote('removal.hours_by_weight');
  const noteE = useRowNote('removal.equipment_rules');
  const eqOptions = draft.equipment.map((e) => ({ value: e.key, label: e.label }));
  return (
    <Section id="removal" title="Install & removal" intro="Labor hours per item by weight, and equipment that is added automatically for heavy or tall items.">
      <RowTable
        caption="Install and de-install hours by weight"
        note={noteH}
        headers={['Item weight up to (lb)', 'Labor hours per item (hours)']}
        addLabel="Add weight band"
        onAdd={() => mutate((d) => d.removal.hours_by_weight.push({ up_to_lb: 100000, hours: 1 }))}
      >
        {draft.removal.hours_by_weight.map((_, i) => {
          const n = `Weight band ${i + 1}`;
          return (
            <tr key={i}>
              <td><NumberField compact kind="num" unit="lb" path={`removal.hours_by_weight.${i}.up_to_lb`} label={`${n} up to pounds`} /></td>
              <td><NumberField compact kind="num" unit="h" path={`removal.hours_by_weight.${i}.hours`} label={`${n} hours`} /></td>
              <RemoveCell label={n} onRemove={() => mutate((d) => d.removal.hours_by_weight.splice(i, 1))} />
            </tr>
          );
        })}
      </RowTable>
      <RowTable
        caption="Equipment rules"
        note={noteE}
        headers={['Add this equipment', 'When an item weighs at least (lb)', 'Or is at least this tall (inches)']}
        addLabel="Add equipment rule"
        onAdd={() => mutate((d) => d.removal.equipment_rules.push({ equipment_key: d.equipment[0]?.key ?? 'gantry', min_weight_lb: 0, min_height_in: 0 }))}
      >
        {draft.removal.equipment_rules.map((r, i) => {
          const n = `Equipment rule ${i + 1}`;
          const opts = eqOptions.some((o) => o.value === r.equipment_key) ? eqOptions : [...eqOptions, { value: r.equipment_key, label: `${r.equipment_key} (not on this card)` }];
          return (
            <tr key={i}>
              <td><SelectField compact width="w-52" path={`removal.equipment_rules.${i}.equipment_key`} label={`${n} equipment`} options={opts} /></td>
              <td><NumberField compact kind="num" unit="lb (0 = any)" path={`removal.equipment_rules.${i}.min_weight_lb`} label={`${n} minimum weight`} /></td>
              <td><NumberField compact kind="num" unit="in (0 = any)" path={`removal.equipment_rules.${i}.min_height_in`} label={`${n} minimum height`} /></td>
              <RemoveCell label={n} onRemove={() => mutate((d) => d.removal.equipment_rules.splice(i, 1))} />
            </tr>
          );
        })}
      </RowTable>
    </Section>
  );
}

function InsuranceSection() {
  return (
    <Section id="insurance" title="Insurance" intro="Valuation coverage is priced as a percentage of the declared value of the work.">
      <Group>
        <NumberField kind="pct" unit="of declared value (bill)" path="insurance.pct_bp" label="Insurance charge" />
        <NumberField kind="pct" unit="of declared value (cost)" path="insurance.cost_pct_bp" label="Insurance cost" />
        <NumberField kind="cents" unit="per estimate" path="insurance.minimum" label="Minimum insurance charge" />
      </Group>
    </Section>
  );
}

function SurchargeTable({ group, keys, caption }: { group: 'access' | 'addons'; keys: readonly string[]; caption: string }) {
  return (
    <RowTable caption={caption} headers={['Name shown on estimate', 'Charged', 'Unit', 'Bill ($)', 'Cost ($)']}>
      {keys.map((k) => {
        const p = `${group}.${k}`;
        return (
          <tr key={k}>
            <td><TextField compact width="w-64" path={`${p}.label`} label={`${k.replace(/_/g, ' ')} name`} maxLength={80} /></td>
            <td><SelectField compact width="w-52" path={`${p}.mode`} label={`${k.replace(/_/g, ' ')} charged`} options={MODE_OPTIONS} /></td>
            <td><TextField compact width="w-28" path={`${p}.unit`} label={`${k.replace(/_/g, ' ')} unit (for example flight, item, hour)`} maxLength={30} /></td>
            <td><NumberField compact kind="cents" unit="each" path={`${p}.bill`} label={`${k.replace(/_/g, ' ')} bill`} /></td>
            <td><NumberField compact kind="cents" unit="each" path={`${p}.cost`} label={`${k.replace(/_/g, ' ')} cost`} /></td>
          </tr>
        );
      })}
    </RowTable>
  );
}

function SurchargesSection() {
  return (
    <Section id="surcharges" title="Access & add-ons" intro="Surcharges for difficult access and optional extras. Flat charges apply once; per-unit charges multiply by the quantity entered on the estimate.">
      <h3 className="mt-4 text-[0.8125rem] font-bold">Access surcharges</h3>
      <SurchargeTable group="access" keys={ACCESS_KEYS} caption="Access surcharges" />
      <h3 className="mt-6 text-[0.8125rem] font-bold">Add-ons</h3>
      <SurchargeTable group="addons" keys={ADDON_KEYS} caption="Add-ons" />
    </Section>
  );
}

function PremiumsSection() {
  const { draft } = useEditor();
  const pct = draft.premiums.rush_mode === 'pct';
  return (
    <Section id="premiums" title="Premiums" intro="The rush charge is either a percentage of the subtotal or a flat fee.">
      <Group>
        <SelectField
          path="premiums.rush_mode"
          label="Rush charge type"
          options={[
            { value: 'pct', label: 'Percent of subtotal' },
            { value: 'flat', label: 'Flat fee' },
          ]}
        />
        {pct ? (
          <NumberField kind="pct" unit="of subtotal" path="premiums.rush_bp" label="Rush percentage" />
        ) : (
          <>
            <NumberField kind="cents" unit="flat (bill)" path="premiums.rush_flat.bill" label="Rush fee, bill" />
            <NumberField kind="cents" unit="flat (cost)" path="premiums.rush_flat.cost" label="Rush fee, cost" />
          </>
        )}
      </Group>
    </Section>
  );
}

function PolicySection() {
  const { draft, base, editable, mutate } = useEditor();
  const cats = draft.policy.tax_categories;
  const changed = base && !same(cats, base.policy.tax_categories);
  return (
    <Section id="policy" title="Policy" intro="Pricing guardrails and tax.">
      <Group>
        <NumberField kind="cents" unit="per estimate" path="policy.min_job_charge" label="Minimum job charge" />
        <NumberField kind="pct" unit="of price" path="policy.target_margin_bp" label="Target margin" help="Estimates below this are flagged." />
        <NumberField kind="pct" unit="of subtotal" path="policy.discount_approval_threshold_bp" label="Discounts above this need approval" />
        <NumberField kind="num" unit="days" path="policy.quote_validity_days" label="Quote valid for" />
        <NumberField kind="pct" unit="of taxable lines" path="policy.tax_rate_bp" label="Tax rate" />
      </Group>
      <fieldset className={`mt-4 ${changed ? 'border-l-4 border-ink bg-wall pl-2' : ''}`}>
        <legend className="a-label">Tax applies to these line categories</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {LINE_CATEGORIES.map((c) => (
            <label key={c} className="flex min-h-[36px] items-center gap-2">
              <input
                type="checkbox"
                checked={cats.includes(c)}
                disabled={!editable}
                onChange={(e) =>
                  mutate((d) => {
                    const on = e.currentTarget.checked;
                    d.policy.tax_categories = LINE_CATEGORIES.filter((x) => (x === c ? on : d.policy.tax_categories.includes(x)));
                  })
                }
              />
              {LINE_CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
        {changed && base && (
          <p className="mt-1 text-[0.75rem] font-bold">
            {'▲ '}Changed. Active card: {base.policy.tax_categories.length ? base.policy.tax_categories.map((c) => LINE_CATEGORY_LABEL[c as keyof typeof LINE_CATEGORY_LABEL] ?? c).join(', ') : 'none'}
          </p>
        )}
      </fieldset>
    </Section>
  );
}

export function RateSections() {
  return (
    <div className="space-y-6">
      <LaborSection />
      <VehiclesSection />
      <EquipmentSection />
      <DistanceSection />
      <ShippingSection />
      <CratingSection />
      <RemovalSection />
      <InsuranceSection />
      <SurchargesSection />
      <PremiumsSection />
      <PolicySection />
    </div>
  );
}
