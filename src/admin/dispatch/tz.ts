/**
 * Office time zone helpers (Intl only, no dependencies).
 *
 * Every dispatch screen shows and edits times in the office's time zone (app_settings.timezone),
 * whatever time zone the device is in. Calendar days are passed around as 'yyyy-MM-dd' strings or
 * as "date holder" Date objects at local midnight (only their y/m/d is used); instants are UTC ISO
 * strings. Converting between the two always goes through the office zone here.
 */

let currentTz: string = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function setAppTz(tz: string | null | undefined): void {
  if (!tz) return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    currentTz = tz;
  } catch {
    /* unknown zone: keep the previous one */
  }
}
export const getAppTz = (): string => currentTz;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, tz: string = currentTz): ZonedParts {
  const p: Record<string, string> = {};
  for (const x of partsFormatter(tz).formatToParts(date)) p[x.type] = x.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WD[p.weekday] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Offset (ms) of `tz` from UTC at the instant `utcMs`. */
function offsetAt(utcMs: number, tz: string): number {
  const z = zonedParts(new Date(utcMs), tz);
  return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second) - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Wall-clock time in `tz` → UTC Date. DST-safe: the offset is resolved twice.
 * Nonexistent times (spring-forward gap) resolve forward by the gap; ambiguous
 * times (fall-back) resolve to the earlier instant.
 */
export function wallTimeToUtc(ymd: string, hhmm: string, tz: string = currentTz): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm || 0);
  const ts1 = guess - offsetAt(guess, tz);
  let ts = guess - offsetAt(ts1, tz);
  const z = zonedParts(new Date(ts), tz);
  if (z.year !== y || z.month !== m || z.day !== d || z.hour !== hh || z.minute !== (mm || 0)) {
    // Spring-forward gap: the wall time doesn't exist; move forward by the gap.
    ts = Math.max(ts1, ts);
    return new Date(ts);
  }
  // Fall-back ambiguity: prefer the earlier of the two valid instants.
  const earlier = ts - 3600_000;
  const ez = zonedParts(new Date(earlier), tz);
  if (ez.year === y && ez.month === m && ez.day === d && ez.hour === hh && ez.minute === (mm || 0)) ts = earlier;
  return new Date(ts);
}

/** UTC ISO → 'yyyy-MM-ddTHH:mm' wall time in tz (for <input type="datetime-local">). */
export function utcToWallInput(iso: string | null | undefined, tz: string = currentTz): string {
  if (!iso) return '';
  const z = zonedParts(new Date(iso), tz);
  return `${z.year}-${pad(z.month)}-${pad(z.day)}T${pad(z.hour)}:${pad(z.minute)}`;
}

/** 'yyyy-MM-ddTHH:mm' wall time in tz → UTC ISO (null for empty). */
export function wallInputToUtc(value: string | null | undefined, tz: string = currentTz): string | null {
  if (!value) return null;
  const [d, t = '00:00'] = value.split('T');
  return wallTimeToUtc(d, t.slice(0, 5), tz).toISOString();
}

/** Calendar date of an instant in tz. */
export function ymdInTz(iso: string | Date, tz: string = currentTz): string {
  const z = zonedParts(typeof iso === 'string' ? new Date(iso) : iso, tz);
  return `${z.year}-${pad(z.month)}-${pad(z.day)}`;
}

export const todayYmd = (tz: string = currentTz): string => ymdInTz(new Date(), tz);

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Monday of the week containing ymd. */
export function weekStartYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysYmd(ymd, -((dow + 6) % 7));
}

/** [00:00, next day 00:00) of an office day, as UTC instants. 23 or 25 hours on DST days. */
export function dayBounds(ymd: string, tz: string = currentTz): { start: Date; end: Date } {
  return { start: wallTimeToUtc(ymd, '00:00', tz), end: wallTimeToUtc(addDaysYmd(ymd, 1), '00:00', tz) };
}

export function fmtTime(iso: string | null | undefined, tz: string = currentTz, locale = 'en-US'): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: tz });
}
export function fmtDay(iso: string, tz: string = currentTz, locale = 'en-US', long = false): string {
  return new Date(iso).toLocaleDateString(locale, {
    weekday: long ? 'long' : 'short',
    month: long ? 'long' : 'short',
    day: 'numeric',
    timeZone: tz,
  });
}
export function fmtDateTime(iso: string | null | undefined, tz: string = currentTz, locale = 'en-US'): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
}

/** Label a plain calendar date ('yyyy-MM-dd') without any zone shifting. */
export function fmtYmd(ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }, locale = 'en-US'): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(locale, { ...opts, timeZone: 'UTC' });
}

/** "Pacific Standard Time (America/Los_Angeles)" style hint. */
export function tzHint(tz: string = currentTz, at: Date = new Date()): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  return `Times in ${name} (${tz})`;
}
