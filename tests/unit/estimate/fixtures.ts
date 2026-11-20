/** Golden fixture estimates for the engine (SAMPLE rates). Fictional items only. */
import type { EstimateInput } from '../../../src/shared/estimate';

const painting = (over: Partial<EstimateInput['items'][number]> = {}) => ({
  id: 'p1',
  description: 'Large painting',
  medium: 'Oil on canvas',
  height_in: 60,
  width_in: 48,
  depth_in: 3,
  weight_lbs: 45,
  quantity: 1,
  declared_value_cents: 12_000_000,
  handling_flags: ['upright'],
  ...over,
});

export const FIXTURES: Record<string, EstimateInput> = {
  local_soft_pack: {
    options: { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 3, labor_hours: 3 },
    stops: [{}, { miles_from_previous: 12.4 }],
    items: [painting({ declared_value_cents: 2_500_000 })],
  },
  long_haul_crate: {
    options: { service_type: 'delivery', vehicle_key: 'truck_air_ride_climate', vehicle_hours: 9, labor_hours: 9, access: { stairs_flight: 2 }, addons: { placement: 1 } },
    stops: [{}, { miles_from_previous: 380.5 }],
    items: [painting({ packing_method: 'custom_crate' })],
  },
  oversize: {
    options: { service_type: 'delivery', vehicle_key: 'truck_air_ride', vehicle_hours: 5, labor_hours: 5 },
    stops: [{}, { miles_from_previous: 40 }],
    items: [painting({ id: 'big', description: 'Monumental canvas', height_in: 110, width_in: 84, depth_in: 4, weight_lbs: 160, handling_flags: ['two_person', 'upright'] })],
  },
  glazed_works_on_paper: {
    options: { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 4, labor_hours: 4 },
    stops: [{}, { miles_from_previous: 22 }],
    items: [
      { id: 'w1', description: 'Framed drawing', medium: 'Graphite on paper, framed', height_in: 24, width_in: 18, depth_in: 2, weight_lbs: 9, quantity: 6, declared_value_cents: 450_000, handling_flags: ['glass', 'no_stack'] },
    ],
  },
  heavy_sculpture_removal_gantry: {
    options: { service_type: 'deinstall', vehicle_key: 'truck_air_ride', vehicle_hours: 6, labor_hours: 2 },
    stops: [{}, { miles_from_previous: 18 }],
    items: [
      { id: 's1', description: 'Bronze figure', medium: 'Bronze sculpture', height_in: 72, width_in: 30, depth_in: 30, weight_lbs: 950, quantity: 1, declared_value_cents: 40_000_000, handling_flags: ['top_heavy', 'two_person', 'upright'] },
    ],
  },
  stairs_no_dock: {
    options: { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 3, labor_hours: 4, access: { stairs_flight: 3, no_dock: 1, long_carry: 2 } },
    stops: [{}, { miles_from_previous: 9 }],
    items: [painting({ height_in: 40, width_in: 30, weight_lbs: 25, declared_value_cents: 800_000 })],
  },
  after_hours_rush: {
    options: { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 3, labor_hours: 3, after_hours: true, rush: true },
    stops: [{}, { miles_from_previous: 15 }],
    items: [painting({ declared_value_cents: 1_500_000 })],
  },
  minimum_charge_floor: {
    options: { service_type: 'pickup', labor_hours: 1, crew_override: { count: 1, reason: 'Single-handler pickup of a small print' } },
    stops: [{}, { miles_from_previous: 2 }],
    items: [{ id: 'm1', description: 'Small print', medium: 'Screenprint on paper', height_in: 12, width_in: 9, depth_in: 1, weight_lbs: 2, quantity: 1, declared_value_cents: 0, handling_flags: [] }],
  },
  discount_needs_approval: {
    options: { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 3, labor_hours: 3, discount_bp: 1500 },
    stops: [{}, { miles_from_previous: 12 }],
    items: [painting({ declared_value_cents: 2_000_000 })],
  },
  client_default_discount_ok: {
    options: { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 3, labor_hours: 3 },
    stops: [{}, { miles_from_previous: 12 }],
    items: [painting({ declared_value_cents: 2_000_000 })],
    client_default_discount_bp: 500,
  },
  tax_on_packing: {
    options: { service_type: 'crating', labor_hours: 2 },
    stops: [{}],
    items: [{ id: 'c1', description: 'Ceramic vessel', medium: 'Glazed ceramic', height_in: 20, width_in: 14, depth_in: 14, weight_lbs: 22, quantity: 2, declared_value_cents: 300_000, handling_flags: ['fragile'] }],
  },
  tax_off: {
    options: { service_type: 'crating', labor_hours: 2 },
    stops: [{}],
    items: [{ id: 'c1', description: 'Ceramic vessel', medium: 'Glazed ceramic', height_in: 20, width_in: 14, depth_in: 14, weight_lbs: 22, quantity: 2, declared_value_cents: 300_000, handling_flags: ['fragile'] }],
  },
  shuttle_multi_stop: {
    options: { service_type: 'shuttle', vehicle_key: 'truck_air_ride', vehicle_hours: 6, labor_hours: 6, access: { timed_access: 1, security_checkin: 1, coi: 1 } },
    stops: [{}, { miles_from_previous: 8.2 }, { miles_from_previous: 14.7 }, { miles_from_previous: 6.1 }],
    items: [
      painting({ id: 'a', description: 'Canvas A', declared_value_cents: 3_000_000 }),
      painting({ id: 'b', description: 'Canvas B', height_in: 30, width_in: 24, weight_lbs: 15, declared_value_cents: 1_200_000 }),
    ],
  },
  crew_override_and_overtime: {
    options: { service_type: 'install', vehicle_key: 'truck_air_ride', vehicle_hours: 10, labor_hours: 8, crew_override: { count: 5, reason: 'Client asked for a faster install window' }, equipment: [{ key: 'lift', days: 2 }] },
    stops: [{}, { miles_from_previous: 30 }],
    items: [painting({ id: 'i1', description: 'Wall work', height_in: 96, width_in: 72, depth_in: 3, weight_lbs: 120, declared_value_cents: 9_000_000, handling_flags: ['two_person'] })],
  },
  storage_and_addons: {
    options: { service_type: 'storage_in', vehicle_key: 'van_liftgate', vehicle_hours: 2, labor_hours: 2, addons: { unpacking: 3, debris_removal: 1, waiting_hour: 1.5, storage_day: 30 } },
    stops: [{}, { miles_from_previous: 6 }],
    items: [painting({ id: 'st', quantity: 3, height_in: 30, width_in: 24, weight_lbs: 18, declared_value_cents: 500_000 })],
  },
  manual_line_and_override: {
    options: { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 3, labor_hours: 3 },
    stops: [{}, { miles_from_previous: 10 }],
    items: [painting({ declared_value_cents: 2_000_000 })],
    overrides: { 'transport.vehicle_time': { unit_price_cents: 5500, reason: 'Van shared with another job' } },
    manual_lines: [
      { id: 'park', category: 'other', description: 'Parking permit', qty: 1, unit: 'each', unit_price_cents: 6500, unit_cost_cents: 6500, client_visible: true },
      { id: 'tip', category: 'other', description: 'Building porter (internal cost)', qty: 1, unit: 'each', unit_price_cents: 0, unit_cost_cents: 4000, client_visible: false },
    ],
  },
};
