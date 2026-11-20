/** Three small sample jobs used to preview what a rate card change does to real-looking prices. Fictional items only. */
import type { EstimateInput } from '../../../shared/estimate';

export interface PreviewSample {
  key: string;
  label: string;
  detail: string;
  input: EstimateInput;
}

export const PREVIEW_SAMPLES: PreviewSample[] = [
  {
    key: 'local_painting',
    label: 'Local painting delivery',
    detail: 'One canvas, 12 miles, small van, 3 hours.',
    input: {
      options: { service_type: 'delivery', vehicle_key: 'van_liftgate', vehicle_hours: 3, labor_hours: 3 },
      stops: [{}, { miles_from_previous: 12 }],
      items: [
        { id: 'p1', description: 'Large painting', medium: 'Oil on canvas', height_in: 60, width_in: 48, depth_in: 3, weight_lbs: 45, quantity: 1, declared_value_cents: 2_500_000, handling_flags: ['upright'] },
      ],
    },
  },
  {
    key: 'regional_crated',
    label: 'Regional crated delivery',
    detail: 'Six framed drawings, 180 miles, air-ride truck, stairs.',
    input: {
      options: { service_type: 'delivery', vehicle_key: 'truck_air_ride', vehicle_hours: 8, labor_hours: 8, access: { stairs_flight: 2 } },
      stops: [{}, { miles_from_previous: 180 }],
      items: [
        { id: 'w1', description: 'Framed drawing', medium: 'Graphite on paper, framed', height_in: 24, width_in: 18, depth_in: 2, weight_lbs: 9, quantity: 6, declared_value_cents: 450_000, handling_flags: ['glass', 'no_stack'] },
      ],
    },
  },
  {
    key: 'heavy_deinstall',
    label: 'Heavy sculpture de-install',
    detail: 'One 950 lb bronze, 18 miles, rush, rigging and a gantry.',
    input: {
      options: { service_type: 'deinstall', vehicle_key: 'truck_air_ride', vehicle_hours: 6, labor_hours: 2, rush: true },
      stops: [{}, { miles_from_previous: 18 }],
      items: [
        { id: 's1', description: 'Bronze figure', medium: 'Bronze sculpture', height_in: 72, width_in: 30, depth_in: 30, weight_lbs: 950, quantity: 1, declared_value_cents: 40_000_000, handling_flags: ['top_heavy', 'two_person', 'upright'] },
      ],
    },
  },
];
