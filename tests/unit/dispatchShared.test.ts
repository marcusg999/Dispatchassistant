import { describe, expect, it } from 'vitest';
import {
  crewMemberSchema,
  homeFor,
  jobItemSchema,
  jobSchema,
  routeAllowed,
  timeOffSchema,
  toE164,
  type StaffRole,
} from '../../src/shared/dispatch';

describe('toE164', () => {
  it.each([
    ['(323) 555-1234', '+13235551234'],
    ['323.555.1234', '+13235551234'],
    ['1 323 555 1234', '+13235551234'],
    ['+44 20 7946 0958', '+442079460958'],
    ['+13235551234', '+13235551234'],
  ])('%s → %s', (input, out) => expect(toE164(input)).toBe(out));
  it.each(['', '555-1234', '+0123456789', 'abc', '23 555 1234 99999'])('rejects %j', (input) => expect(toE164(input)).toBeNull());
});

describe('jobItemSchema', () => {
  const base = { description: 'Framed painting', quantity: 1, handling_flags: [] as string[] };
  it('accepts a valid item with dimensions and weight', () => {
    expect(jobItemSchema.safeParse({ ...base, height_in: 72, width_in: 96, depth_in: 4, weight_lbs: 140, handling_flags: ['glass', 'two_person'] }).success).toBe(true);
  });
  it.each([
    ['zero height', { height_in: 0 }],
    ['negative width', { width_in: -3 }],
    ['depth over 1200', { depth_in: 1201 }],
    ['zero weight', { weight_lbs: 0 }],
    ['weight over 40000', { weight_lbs: 40001 }],
    ['non-integer quantity', { quantity: 1.5 }],
    ['zero quantity', { quantity: 0 }],
    ['unknown flag', { handling_flags: ['sticky'] }],
    ['short description', { description: 'x' }],
  ])('rejects %s', (_n, patch) => expect(jobItemSchema.safeParse({ ...base, ...patch }).success).toBe(false));
});

describe('jobSchema', () => {
  const base = { title: 'Deliver works', job_type: 'delivery', status: 'draft', start_at: '2031-01-01T10:00:00Z', end_at: '2031-01-01T12:00:00Z' };
  it('requires end after start', () => {
    expect(jobSchema.safeParse(base).success).toBe(true);
    expect(jobSchema.safeParse({ ...base, end_at: '2031-01-01T09:00:00Z' }).success).toBe(false);
    expect(jobSchema.safeParse({ ...base, end_at: base.start_at }).success).toBe(false);
  });
  it('rejects unknown job types and statuses', () => {
    expect(jobSchema.safeParse({ ...base, job_type: 'party' }).success).toBe(false);
    expect(jobSchema.safeParse({ ...base, status: 'maybe' }).success).toBe(false);
  });
});

describe('timeOffSchema', () => {
  const base = { crew_member_id: 'x', start_date: '2031-01-02', end_date: '2031-01-03' };
  it('requires end on or after start', () => {
    expect(timeOffSchema.safeParse(base).success).toBe(true);
    expect(timeOffSchema.safeParse({ ...base, end_date: '2031-01-02' }).success).toBe(true);
    expect(timeOffSchema.safeParse({ ...base, end_date: '2031-01-01' }).success).toBe(false);
  });
});

describe('crewMemberSchema', () => {
  const base = { display_name: 'Avery Lane', position: 'lead', sms_opt_in: false };
  it('accepts E.164 phones only', () => {
    expect(crewMemberSchema.safeParse({ ...base, phone: '+13235550101' }).success).toBe(true);
    expect(crewMemberSchema.safeParse({ ...base, phone: '323-555-0101' }).success).toBe(false);
    expect(crewMemberSchema.safeParse({ ...base, phone: null }).success).toBe(true);
  });
  it('validates email and lift capacity', () => {
    expect(crewMemberSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(crewMemberSchema.safeParse({ ...base, lift_capacity_lbs: 600 }).success).toBe(false);
  });
});

describe('role routing', () => {
  const roles: (StaffRole | null)[] = ['admin', 'dispatcher', 'viewer', 'crew', null];
  it('lands each role on its home', () => {
    expect(homeFor('admin', false)).toBe('/admin');
    expect(homeFor('dispatcher', false)).toBe('/admin/dispatch');
    expect(homeFor('viewer', true)).toBe('/admin/dispatch');
    expect(homeFor('crew', false)).toBe('/admin/my-jobs');
    expect(homeFor(null, true)).toBe('/admin/hr');
  });
  it('crew reach only My jobs and account', () => {
    for (const p of ['/admin', '/admin/s/abc', '/admin/dispatch', '/admin/dispatch/week', '/admin/audit', '/admin/admins', '/admin/hr', '/admin/tools'])
      expect(routeAllowed(p, 'crew', false), p).toBe(false);
    expect(routeAllowed('/admin/my-jobs', 'crew', false)).toBe(true);
    expect(routeAllowed('/admin/account', 'crew', false)).toBe(true);
  });
  it('viewer and dispatcher reach dispatch, not the suggestion console or roles', () => {
    for (const r of ['viewer', 'dispatcher'] as const) {
      expect(routeAllowed('/admin/dispatch', r, false)).toBe(true);
      expect(routeAllowed('/admin/dispatch/week', r, false)).toBe(true);
      expect(routeAllowed('/admin/dispatch/roles', r, false)).toBe(false);
      expect(routeAllowed('/admin', r, false)).toBe(false);
      expect(routeAllowed('/admin/audit', r, false)).toBe(false);
      expect(routeAllowed('/admin/my-jobs', r, false)).toBe(false);
    }
  });
  it('admin reaches everything except My jobs (and HR without HR membership)', () => {
    for (const p of ['/admin', '/admin/s/x', '/admin/dispatch', '/admin/dispatch/roles', '/admin/audit', '/admin/admins', '/admin/tools', '/admin/account'])
      expect(routeAllowed(p, 'admin', false), p).toBe(true);
    expect(routeAllowed('/admin/my-jobs', 'admin', false)).toBe(false);
    expect(routeAllowed('/admin/hr', 'admin', false)).toBe(false);
  });
  it('HR-only reaches only HR pages, audit and account', () => {
    expect(routeAllowed('/admin/hr', null, true)).toBe(true);
    expect(routeAllowed('/admin/hr/team', null, true)).toBe(true);
    for (const p of ['/admin/dispatch', '/admin/my-jobs', '/admin/s/x', '/admin/admins']) expect(routeAllowed(p, null, true), p).toBe(false);
  });
  it('no role reaches nothing', () => {
    for (const r of roles.filter((x) => x === null))
      for (const p of ['/admin', '/admin/dispatch', '/admin/my-jobs', '/admin/account']) expect(routeAllowed(p, r, false), p).toBe(false);
  });
});
