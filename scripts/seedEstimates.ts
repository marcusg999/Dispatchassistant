/**
 * Phase 3 demo data, priced by the real engine. Fictional clients only.
 * Local quote link for testing the client page: /q/seedsentquotetoken000000000000A (estimate 5).
 */
import { createHash } from 'node:crypto';
import {
  SAMPLE_CREW_RULES,
  SAMPLE_PACKING_RULES,
  SAMPLE_RATES,
  computeEstimate,
  type EstimateInput,
  type RateSnapshot,
} from '../src/shared/estimate';

export const SEED_QUOTE_TOKENS = {
  sent: 'seedsentquotetoken000000000000A',
  viewed: 'seedviewedquotetoken0000000000B',
  accepted: 'seedacceptedquotetoken00000000C',
};

const q = (s: string | null | undefined) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

const CLIENTS = [
  { k: 'harbor', name: 'Example Contemporary Gallery', kind: 'gallery', discount: 0, contact: ['Registrar Desk', 'Registrar', 'registrar@example.com', '+13235550201'] },
  { k: 'family', name: 'Sample Family Collection', kind: 'collector', discount: 500, contact: ['Collection Manager', 'Collections manager', 'collection@example.com', '+13235550202'] },
  { k: 'design', name: 'Placeholder Design Studio', kind: 'designer', discount: 0, contact: ['Project Lead', 'Designer', 'studio@example.com', '+13235550203'] },
  { k: 'corp', name: 'Demo Corporate Art Program', kind: 'corporate', discount: 1000, contact: ['Art Program Office', 'Curator', 'artprogram@example.com', '+13235550204'] },
  { k: 'museum', name: 'Fictional Art Museum', kind: 'museum', discount: 500, contact: ['Registrar Office', 'Registrar', 'registrar@museum.example', '+13235550205'] },
  { k: 'found', name: 'Test Sculpture Foundation', kind: 'other', discount: 0, contact: ['Foundation Office', 'Owner', 'office@foundation.example', '+13235550206'] },
];

interface SeedEstimate {
  title: string;
  client: string;
  status: string;
  service: EstimateInput['options']['service_type'];
  input: EstimateInput;
  stops: { kind: string; site: string; address: string; flags?: string[] }[];
  dayOffset: number;
  token?: string;
  accept?: boolean;
  convert?: boolean;
  template?: string;
}

const painting = (id: string, over: Record<string, unknown> = {}) => ({
  id, description: 'Large painting', artist_title: null, medium: 'Oil on canvas', height_in: 60, width_in: 48, depth_in: 3,
  weight_lbs: 45, quantity: 1, declared_value_cents: 2_500_000, handling_flags: ['upright'], ...over,
});
const two = (miles: number) => [{}, { miles_from_previous: miles }];
const twoStops = (a: string, b: string, flags: string[] = []) => [
  { kind: 'origin', site: 'Warehouse', address: '1200 Example Ave, Los Angeles, CA', flags: ['loading_dock'] },
  { kind: 'destination', site: a, address: b, flags },
];

const ESTIMATES: SeedEstimate[] = [
  { title: 'Deliver a painting to a residence', client: 'family', status: 'draft', service: 'delivery', dayOffset: 10,
    input: { options: { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 3, labor_hours: 3 }, stops: two(12.4), items: [painting('i1')] },
    stops: twoStops('Private residence', '45 Sample Canyon Rd, Los Angeles, CA', ['stairs']) },
  { title: 'Long-haul crated delivery', client: 'harbor', status: 'draft', service: 'delivery', dayOffset: 21,
    input: { options: { service_type: 'delivery', vehicle_key: 'truck_air_ride_climate', vehicle_hours: 9, labor_hours: 9, access: { stairs_flight: 2 }, addons: { placement: 1 } }, stops: two(380.5), items: [painting('i1', { packing_method: 'custom_crate', declared_value_cents: 12_000_000 })] },
    stops: twoStops('Gallery', '9 Example Plaza, San Francisco, CA') },
  { title: 'Corporate lobby rotation', client: 'corp', status: 'pending_approval', service: 'install', dayOffset: 14,
    input: { options: { service_type: 'install', vehicle_key: 'truck_air_ride', vehicle_hours: 5, labor_hours: 4, discount_bp: 1500 }, stops: two(18), items: [painting('i1', { quantity: 4, height_in: 40, width_in: 30, weight_lbs: 25, declared_value_cents: 1_500_000 })] },
    stops: twoStops('Office lobby', '800 Placeholder Blvd, Los Angeles, CA', ['freight_elevator', 'coi_required']) },
  { title: 'Museum loan return', client: 'museum', status: 'approved', service: 'delivery', dayOffset: 18,
    input: { options: { service_type: 'delivery', vehicle_key: 'truck_air_ride_climate', vehicle_hours: 6, labor_hours: 5 }, stops: two(64), items: [painting('i1', { declared_value_cents: 20_000_000 }), { id: 'i2', description: 'Framed drawing', artist_title: null, medium: 'Ink on paper, framed', height_in: 24, width_in: 18, depth_in: 2, weight_lbs: 9, quantity: 3, declared_value_cents: 800_000, handling_flags: ['glass'] }] },
    stops: twoStops('Museum dock', '100 Fictional Museum Way, Los Angeles, CA', ['loading_dock', 'security_checkin']) },
  { title: 'Designer install: two works', client: 'design', status: 'sent', service: 'install', dayOffset: 9, token: SEED_QUOTE_TOKENS.sent,
    input: { options: { service_type: 'install', vehicle_key: 'van_liftgate', vehicle_hours: 4, labor_hours: 3, addons: { placement: 2, debris_removal: 1 } }, stops: two(15), items: [painting('i1', { quantity: 2, height_in: 36, width_in: 48, weight_lbs: 30, declared_value_cents: 600_000 })] },
    stops: twoStops('Client home', '12 Mock Ln, Los Angeles, CA', ['stairs']) },
  { title: 'Gallery pickup for storage', client: 'harbor', status: 'viewed', service: 'storage_in', dayOffset: 7, token: SEED_QUOTE_TOKENS.viewed,
    input: { options: { service_type: 'storage_in', vehicle_key: 'van_liftgate', vehicle_hours: 2, labor_hours: 2, addons: { storage_day: 60 } }, stops: two(6), items: [painting('i1', { quantity: 2, height_in: 30, width_in: 24, weight_lbs: 18 })] },
    stops: twoStops('Gallery', '9 Demo St, Los Angeles, CA') },
  { title: 'Sculpture de-install', client: 'found', status: 'accepted', service: 'deinstall', dayOffset: 12, token: SEED_QUOTE_TOKENS.accepted, accept: true, convert: true,
    input: { options: { service_type: 'deinstall', vehicle_key: 'truck_air_ride', vehicle_hours: 6, labor_hours: 2 }, stops: two(18), items: [{ id: 'i1', description: 'Bronze figure', artist_title: null, medium: 'Bronze sculpture', height_in: 72, width_in: 30, depth_in: 30, weight_lbs: 950, quantity: 1, declared_value_cents: 40_000_000, handling_flags: ['top_heavy', 'two_person', 'upright'] }] },
    stops: twoStops('Garden', '300 Example Plaza, Los Angeles, CA', ['timed_access']) },
  { title: 'Ceramics crating', client: 'family', status: 'declined', service: 'crating', dayOffset: 5,
    input: { options: { service_type: 'crating', labor_hours: 2 }, stops: [{}], items: [{ id: 'i1', description: 'Ceramic vessel', artist_title: null, medium: 'Glazed ceramic', height_in: 20, width_in: 14, depth_in: 14, weight_lbs: 22, quantity: 2, declared_value_cents: 300_000, handling_flags: ['fragile'] }] },
    stops: [{ kind: 'origin', site: 'Crate shop', address: '1200 Example Ave, Los Angeles, CA', flags: ['loading_dock'] }] },
  { title: 'Print delivery (expired quote)', client: 'design', status: 'expired', service: 'delivery', dayOffset: -10,
    input: { options: { service_type: 'delivery', labor_hours: 1, crew_override: { count: 1, reason: 'Small print' } }, stops: two(2), items: [{ id: 'i1', description: 'Small print', artist_title: null, medium: 'Screenprint on paper', height_in: 12, width_in: 9, depth_in: 1, weight_lbs: 2, quantity: 1, declared_value_cents: 0, handling_flags: [] }] },
    stops: twoStops('Studio', '5 Mock Ln, Los Angeles, CA') },
  { title: 'Museum crate and ship', client: 'museum', status: 'accepted', service: 'delivery', dayOffset: 25, accept: true,
    input: { options: { service_type: 'delivery', vehicle_key: 'truck_air_ride_climate', vehicle_hours: 8, labor_hours: 6 }, stops: two(120), items: [painting('i1', { packing_method: 'padded_crate', declared_value_cents: 15_000_000 })] },
    stops: twoStops('Museum dock', '100 Fictional Museum Way, Los Angeles, CA', ['loading_dock']) },
  { title: 'Weekly gallery shuttle (template)', client: 'harbor', status: 'draft', service: 'shuttle', dayOffset: 30, template: 'Weekly gallery shuttle',
    input: { options: { service_type: 'shuttle', vehicle_key: 'van_liftgate', vehicle_hours: 4, labor_hours: 4 }, stops: [{}, { miles_from_previous: 6 }, { miles_from_previous: 9 }], items: [painting('i1', { quantity: 3, height_in: 30, width_in: 24, weight_lbs: 15 })] },
    stops: [
      { kind: 'origin', site: 'Warehouse', address: '1200 Example Ave, Los Angeles, CA', flags: ['loading_dock'] },
      { kind: 'stop', site: 'Gallery one', address: '10 Demo St, Los Angeles, CA' },
      { kind: 'destination', site: 'Gallery two', address: '20 Demo St, Los Angeles, CA' },
    ] },
];

export function buildSeedSql(): string {
  const snap: RateSnapshot = { rates: SAMPLE_RATES, packing_rules: SAMPLE_PACKING_RULES, crew_rules: SAMPLE_CREW_RULES };
  const L: string[] = [];
  L.push('-- GENERATED by scripts/gen-seed-estimates.mjs from the shared engine. Do not edit by hand.');
  L.push('-- Phase 3 · SAMPLE rate card, rules, placeholder terms, fictional clients and estimates.');
  L.push("insert into public.staff_roles (email, role) values ('estimator@example.com', 'estimator');");
  L.push(`insert into public.rate_cards (name, status, effective_from, rates, is_sample) values ('SAMPLE: replace with your rates', 'active', current_date, ${j(SAMPLE_RATES)}, true);`);
  for (const r of SAMPLE_PACKING_RULES)
    L.push(`insert into public.packing_rules (medium_match, condition, method, note, position) values (${q(r.medium_match)}, ${q(r.condition)}, ${q(r.method)}, ${q(r.note)}, ${r.position});`);
  for (const r of SAMPLE_CREW_RULES)
    L.push(`insert into public.crew_size_rules (kind, crew, param, equipment_key, note, position) values (${q(r.kind)}, ${r.crew}, ${q(r.param)}, ${q(r.equipment_key ?? null)}, ${q(r.note)}, ${r.position});`);
  L.push(`insert into public.terms_versions (version, title, body, is_current) values (1, 'Quote terms (PLACEHOLDER)', ${q('PLACEHOLDER TERMS: replace with terms reviewed by your own counsel before sending real quotes.\n\n1. This quote is valid until the date shown.\n2. Prices are based on the items, sizes, weights and access described; changes may change the price.\n3. Valuation coverage applies only to the declared values listed.\n4. Scheduling is confirmed after acceptance.')}, true);`);

  L.push('create temporary table seed_est (k text primary key, id uuid) on commit drop;');
  for (const c of CLIENTS) {
    L.push(`with c as (insert into public.clients (name, kind, default_discount_bp, billing_address) values (${q(c.name)}, ${q(c.kind)}, ${c.discount}, '1 Example St, Los Angeles, CA') returning id)
insert into seed_est select ${q('client_' + c.k)}, id from c;`);
    L.push(`insert into public.client_contacts (client_id, name, role, email, phone, is_primary) select id, ${q(c.contact[0])}, ${q(c.contact[1])}, ${q(c.contact[2])}, ${q(c.contact[3])}, true from seed_est where k = ${q('client_' + c.k)};`);
  }

  ESTIMATES.forEach((e, idx) => {
    const k = `est_${idx + 1}`;
    const client = CLIENTS.find((c) => c.k === e.client)!;
    const input: EstimateInput = { ...e.input, client_default_discount_bp: client.discount };
    const r = computeEstimate(input, snap);
    const inputs = { options: e.input.options, overrides: e.input.overrides ?? {}, manual_lines: e.input.manual_lines ?? [] };
    L.push(`-- ${idx + 1}. ${e.title} (${e.status}) total ${r.totals.total_cents} cents`);
    L.push(`with e as (insert into public.estimates (title, client_id, contact_id, service_type, requested_date, inputs, notes_client, is_template, template_name)
  select ${q(e.title)}, c.id, (select id from public.client_contacts where client_id = c.id and is_primary), ${q(e.service)}, current_date + ${e.dayOffset}, ${j(inputs)},
         'Thank you for the opportunity to quote this move.', ${e.template ? 'true' : 'false'}, ${q(e.template ?? null)}
  from seed_est c where c.k = ${q('client_' + e.client)} returning id)
insert into seed_est select ${q(k)}, id from e;`);
    e.stops.forEach((s, i) => {
      const miles = (e.input.stops[i]?.miles_from_previous ?? null) as number | null;
      L.push(`insert into public.estimate_stops (estimate_id, position, kind, site_name, address, access_flags, miles_from_previous) select id, ${i}, ${q(s.kind)}, ${q(s.site)}, ${q(s.address)}, ${q('{' + (s.flags ?? []).join(',') + '}')}, ${miles ?? 'null'} from seed_est where k = ${q(k)};`);
    });
    // Items keep their engine ids via a mapping table so lines link to the right row.
    for (const [i, it] of e.input.items.entries()) {
      const x = it as typeof it & { artist_title?: string | null };
      L.push(`with it as (insert into public.estimate_items (estimate_id, position, description, artist_title, medium, height_in, width_in, depth_in, weight_lbs, quantity, declared_value_cents, handling_flags, packing_method, packing_override_reason)
  select id, ${i}, ${q(x.description)}, ${q(x.artist_title ?? null)}, ${q(x.medium)}, ${x.height_in ?? 'null'}, ${x.width_in ?? 'null'}, ${x.depth_in ?? 'null'}, ${x.weight_lbs ?? 'null'}, ${x.quantity}, ${x.declared_value_cents ?? 'null'}, ${q('{' + x.handling_flags.join(',') + '}')}, ${q(x.packing_method ?? null)}, ${x.packing_method ? q('Chosen for this move') : 'null'}
  from seed_est where k = ${q(k)} returning id)
insert into seed_est select ${q(`${k}_${it.id}`)}, id from it;`);
    }
    const lines = r.lines.map((l) => ({ ...l, item_id: l.item_id ? `@@${k}_${l.item_id}@@` : null }));
    const patch: Record<string, unknown> = {
      subtotal_cents: r.totals.subtotal_cents, discount_bp: r.totals.discount_bp, discount_cents: r.totals.discount_cents, tax_cents: r.totals.tax_cents,
      total_cents: r.totals.total_cents, cost_cents: r.totals.cost_cents, margin_cents: r.totals.margin_cents, margin_bp: r.totals.margin_bp,
      suggested_crew: r.crew.applied, needs_approval: r.flags.needs_approval, approval_reasons: r.flags.approval_reasons, status: e.status === 'converted' ? 'accepted' : e.status,
    };
    if (['approved', 'sent', 'viewed', 'accepted', 'declined', 'expired'].includes(e.status) && r.flags.needs_approval)
      Object.assign(patch, { approved_by: 'admin@example.com', approved_total_cents: r.totals.total_cents });
    // Lines as a SQL string expression; item placeholders become the real uuids.
    const lineSql = JSON.stringify(lines)
      .replace(/'/g, "''")
      .replace(/"@@([^@]+)@@"/g, (_m, key) => `"' || (select id from seed_est where k = '${key}')::text || '"`);
    const extra: string[] = [];
    if (['sent', 'viewed', 'accepted', 'declined', 'expired'].includes(e.status)) extra.push(`'sent_at', (now() - interval '3 days')::text, 'valid_until', (current_date + ${e.status === 'expired' ? -2 : 27})::text`);
    if (e.status === 'declined') extra.push(`'declined_at', now()::text, 'decline_reason', 'Went with a different schedule'`);
    if (e.status === 'approved' || patch.approved_by) extra.push(`'approved_at', (now() - interval '4 days')::text`);
    const patchExpr = `${j(patch)}${extra.length ? ` || jsonb_build_object(${extra.join(', ')})` : ''}`;
    L.push(`select public.server_apply_estimate((select id from seed_est where k = ${q(k)}), 'estimator@example.com', ${patchExpr}, ('${lineSql}')::jsonb, ${j(r.packing)});`);
    if (e.token) {
      L.push(`select public.server_create_quote_link((select id from seed_est where k = ${q(k)}), 'estimator@example.com', ${q(sha(e.token))}, now() + interval '${e.status === 'expired' ? '-1' : '27'} days');`);
    }
    if (e.accept) {
      L.push(`insert into public.quote_acceptances (estimate_id, revision, quote_link_id, accepted_name, accepted_title, accepted_email, signature_text, agreed_to_terms, terms_version_id, total_cents, ip, user_agent)
  select e.id, 1, (select id from public.quote_links where estimate_id = e.id order by created_at desc limit 1), 'Sample Signer', 'Registrar', 'signer@example.com', 'Sample Signer', true,
         (select id from public.terms_versions where is_current), e.total_cents, '127.0.0.1', 'seed'
  from public.estimates e where e.id = (select id from seed_est where k = ${q(k)});`);
      L.push(`update public.estimates set accepted_at = now() - interval '1 day' where id = (select id from seed_est where k = ${q(k)});`);
    }
    if (e.convert) {
      L.push(`select set_config('request.jwt.claims', '{"role":"authenticated","email":"admin@example.com"}', false);`);
      L.push(`select private.convert_estimate_to_job((select id from seed_est where k = ${q(k)}));`);
      L.push(`select set_config('request.jwt.claims', '', false);`);
    }
  });
  return L.join('\n') + '\n';
}
