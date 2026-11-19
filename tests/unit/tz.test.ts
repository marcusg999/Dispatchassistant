import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  dayBounds,
  fmtTime,
  tzHint,
  utcToWallInput,
  wallInputToUtc,
  wallTimeToUtc,
  weekStartYmd,
  ymdInTz,
} from '../../src/admin/dispatch/tz';

const LA = 'America/Los_Angeles';

describe('office time zone helpers', () => {
  it('converts wall time to UTC on normal days', () => {
    expect(wallTimeToUtc('2026-11-19', '08:00', LA).toISOString()).toBe('2026-11-19T16:00:00.000Z'); // PST
    expect(wallTimeToUtc('2026-07-04', '08:00', LA).toISOString()).toBe('2026-07-04T15:00:00.000Z'); // PDT
    expect(wallTimeToUtc('2026-11-19', '08:00', 'Asia/Tokyo').toISOString()).toBe('2026-11-18T23:00:00.000Z');
  });

  it('handles the spring-forward day (2026-03-08)', () => {
    const { start, end } = dayBounds('2026-03-08', LA);
    expect(start.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3600_000).toBe(23);
    expect(wallTimeToUtc('2026-03-08', '01:30', LA).toISOString()).toBe('2026-03-08T09:30:00.000Z');
    expect(wallTimeToUtc('2026-03-08', '03:00', LA).toISOString()).toBe('2026-03-08T10:00:00.000Z');
    // 02:30 doesn't exist; it resolves forward to 03:30 PDT.
    expect(utcToWallInput(wallTimeToUtc('2026-03-08', '02:30', LA).toISOString(), LA)).toBe('2026-03-08T03:30');
  });

  it('handles the fall-back day (2026-11-01)', () => {
    const { start, end } = dayBounds('2026-11-01', LA);
    expect(start.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3600_000).toBe(25);
    // 01:30 happens twice; the earlier (PDT) instant wins.
    expect(wallTimeToUtc('2026-11-01', '01:30', LA).toISOString()).toBe('2026-11-01T08:30:00.000Z');
    expect(wallTimeToUtc('2026-11-01', '03:00', LA).toISOString()).toBe('2026-11-01T11:00:00.000Z');
  });

  it('round-trips datetime-local values', () => {
    for (const v of ['2026-11-19T08:00', '2026-03-08T01:59', '2026-03-08T03:00', '2026-11-01T00:30', '2026-11-01T23:45', '2026-12-31T23:59']) {
      expect(utcToWallInput(wallInputToUtc(v, LA), LA)).toBe(v);
    }
    expect(wallInputToUtc('', LA)).toBeNull();
    expect(utcToWallInput(null, LA)).toBe('');
  });

  it('dates instants in the office zone, not the device zone', () => {
    expect(ymdInTz('2026-11-20T06:00:00Z', LA)).toBe('2026-11-19');
    expect(ymdInTz('2026-11-20T06:00:00Z', 'Asia/Tokyo')).toBe('2026-11-20');
    expect(fmtTime('2026-11-19T16:00:00Z', LA)).toBe('8:00 AM');
  });

  it('does calendar arithmetic on plain dates', () => {
    expect(addDaysYmd('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysYmd('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysYmd('2026-01-01', -1)).toBe('2025-12-31');
    expect(weekStartYmd('2026-11-19')).toBe('2026-11-16'); // Thu → Mon
    expect(weekStartYmd('2026-11-22')).toBe('2026-11-16'); // Sun → Mon
    expect(weekStartYmd('2026-11-16')).toBe('2026-11-16');
  });

  it('describes the zone', () => {
    expect(tzHint(LA, new Date('2026-11-19T12:00:00Z'))).toBe('Times in Pacific Standard Time (America/Los_Angeles)');
  });
});
