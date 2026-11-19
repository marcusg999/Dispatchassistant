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

/** Local datetime-input helpers (value format yyyy-MM-ddTHH:mm in the browser's zone). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
