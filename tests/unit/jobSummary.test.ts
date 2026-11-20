import { describe, expect, it } from 'vitest';
import { buildJobSummary, type SummaryJob } from '../../src/shared/dispatch';

const job: SummaryJob = {
  job_number: 'J-2026-0007',
  title: 'Deliver framed works',
  job_type: 'delivery',
  start_at: '2026-11-20T16:00:00Z',
  end_at: '2026-11-20T22:00:00Z',
  call_time: '2026-11-20T15:00:00Z',
  call_location: 'Shop, bay 2',
  crew_notes: 'Shoe covers inside.',
  office_notes: 'Invoice after placement.',
  team_lead: { name: 'Avery Lane', phone: '+13235550101' },
  crew: [
    { id: 'a', name: 'Avery Lane', phone: '+13235550101', role_on_job: 'Lead' },
    { id: 'b', name: 'Bo Kimura', phone: '+13235550102', call_time_override: '2026-11-20T15:30:00Z' },
  ],
  assets: [{ kind: 'truck', name: 'Truck 26' }],
  stops: [
    { kind: 'origin', site_name: 'Warehouse', address: '1200 Example Ave', access_flags: ['loading_dock'] },
    { kind: 'destination', address: '45 Sample Rd', contact_name: 'House manager', contact_phone: '+13235550191', access_flags: ['stairs'], access_notes: '12 steps.' },
  ],
  items: [{ description: 'Large framed painting', quantity: 1, height_in: 72, width_in: 96, depth_in: 4, weight_lbs: 140, handling_flags: ['glass', 'two_person'] }],
};
const TZ = 'America/Los_Angeles';

describe('buildJobSummary', () => {
  it('includes the essentials as plain text', () => {
    const s = buildJobSummary(job, { timeZone: TZ });
    expect(s).toContain('J-2026-0007 · Delivery · Deliver framed works');
    expect(s).toContain('Call: 7:00 AM at Shop, bay 2');
    expect(s).toContain('Lead: Avery Lane (323) 555-0101');
    expect(s).toContain('Truck/equipment: Truck 26');
    expect(s).toContain('Contact: House manager (323) 555-0191');
    expect(s).toContain('Access: Stairs');
    expect(s).toContain('72 × 96 × 4 in, 140 lb');
    expect(s).toContain('[Glass or glazed; Two-person minimum]');
    expect(s).toContain('Crew notes: Shoe covers inside.');
  });

  it('uses a crew member’s own call-time override', () => {
    expect(buildJobSummary(job, { timeZone: TZ, forCrewMember: 'b' })).toContain('Call: 7:30 AM');
    expect(buildJobSummary(job, { timeZone: TZ, forCrewMember: 'a' })).toContain('Call: 7:00 AM');
  });

  it('leaves out office notes unless asked', () => {
    expect(buildJobSummary(job, { timeZone: TZ })).not.toContain('Invoice after placement');
    expect(buildJobSummary(job, { timeZone: TZ, includeOfficeNotes: true })).toContain('Office notes: Invoice after placement.');
  });
});
