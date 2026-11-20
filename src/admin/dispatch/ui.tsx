/** Shared dispatch UI atoms: flag badges (icon + label, never color alone), status, conflicts. */
import {
  ACCESS_FLAG_LABEL,
  CONFLICT_LABEL,
  HANDLING_FLAG,
  JOB_STATUS_LABEL,
  JOB_TYPE_LABEL,
  type AccessFlag,
  type HandlingFlag,
  type JobStatus,
  type JobType,
} from '../../shared/dispatch';
import type { Conflict } from './data';
import { addDaysYmd, dayBounds, getAppTz, todayYmd, tzHint, utcToWallInput, wallInputToUtc, ymdInTz } from './tz';

export function FlagBadge({ flag, big = false }: { flag: string; big?: boolean }) {
  const f = HANDLING_FLAG[flag as HandlingFlag];
  if (!f) return null;
  return (
    <span className={`flag-badge ${big ? 'flag-badge-big' : ''}`} title={f.label}>
      <span className="flag-glyph" aria-hidden="true">
        {f.glyph}
      </span>
      <span className={big ? '' : 'sr-only-sm'}>{f.label}</span>
    </span>
  );
}

export function FlagList({ flags, big = false, compact = false }: { flags: string[]; big?: boolean; compact?: boolean }) {
  if (!flags.length) return null;
  return (
    <ul className={`flex flex-wrap gap-1 ${big ? 'gap-2' : ''}`} aria-label="Handling flags">
      {flags.map((f) => (
        <li key={f}>{compact ? <CompactFlag flag={f} /> : <FlagBadge flag={f} big={big} />}</li>
      ))}
    </ul>
  );
}

function CompactFlag({ flag }: { flag: string }) {
  const f = HANDLING_FLAG[flag as HandlingFlag];
  if (!f) return null;
  return (
    <span className="flag-badge" title={f.label}>
      <span className="flag-glyph" aria-hidden="true">
        {f.glyph}
      </span>
      <span className="sr-only">{f.label}</span>
    </span>
  );
}

export const accessLabel = (f: string) => ACCESS_FLAG_LABEL[f as AccessFlag] ?? f;

export function JobStatusPill({ status }: { status: string }) {
  return <span className={`job-status job-status-${status}`}>{JOB_STATUS_LABEL[status as JobStatus] ?? status}</span>;
}
export const jobTypeLabel = (t: string) => JOB_TYPE_LABEL[t as JobType] ?? t;

export function ConflictBadges({ conflicts, detail = false }: { conflicts: Conflict[]; detail?: boolean }) {
  if (!conflicts.length) return null;
  if (!detail) {
    const codes = [...new Set(conflicts.map((c) => c.code))];
    return (
      <ul className="flex flex-wrap gap-1" aria-label={`${conflicts.length} warning${conflicts.length === 1 ? '' : 's'}`}>
        {codes.map((c) => (
          <li key={c} className="conflict-badge" title={conflicts.filter((x) => x.code === c).map((x) => x.message).join('\n')}>
            <span aria-hidden="true">⚠</span> {CONFLICT_LABEL[c] ?? c}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-1" role="list" aria-label="Warnings">
      {conflicts.map((c, i) => (
        <li key={i} className="conflict-row">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>{CONFLICT_LABEL[c.code] ?? c.code}:</strong> {c.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Datetime-input helpers: values are office wall time ('yyyy-MM-ddTHH:mm' in the
 * app_settings time zone), whatever zone the device is in. See ./tz.ts.
 */
export function toLocalInput(iso: string | null | undefined): string {
  return utcToWallInput(iso, getAppTz());
}
export const fromLocalInput = (v: string) => wallInputToUtc(v, getAppTz());

/**
 * Calendar "date holders": a Date at LOCAL midnight whose y/m/d names an office day.
 * Only use them for calendar math and labels; convert to instants with officeDayBounds().
 */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
/** Today in the office time zone, as a date holder. */
export const officeToday = (): Date => parseYmd(todayYmd(getAppTz()));
/** UTC instants bounding an office day (or several), for queries. */
export function officeDayBounds(day: Date, days = 1): { start: Date; end: Date } {
  const k = ymd(day);
  return { start: dayBounds(k, getAppTz()).start, end: dayBounds(addDaysYmd(k, days - 1), getAppTz()).end };
}
/** Office calendar date of an instant, as 'yyyy-MM-dd'. */
export const officeYmd = (iso: string): string => ymdInTz(iso, getAppTz());

/** Small "Times in Pacific Standard Time (America/Los_Angeles)" note. */
export function TzNote({ className = '' }: { className?: string }) {
  return <p className={`text-[0.75rem] text-muted ${className}`}>{tzHint(getAppTz())}</p>;
}
