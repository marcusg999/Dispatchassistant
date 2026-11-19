/** Board helpers: day/week bounds, roster grouping, conflict diffs, keyboard drag coordinates. */
import type { KeyboardCoordinateGetter, UniqueIdentifier } from '@dnd-kit/core';
import { KeyboardCode } from '@dnd-kit/core';
import type { BoardData, Conflict } from '../data';
import { parseYmd, ymd } from '../ui';

export function dateFromQuery(): Date {
  const q = new URLSearchParams(location.search).get('date');
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return parseYmd(q);
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function setDateQuery(d: Date) {
  const url = new URL(location.href);
  url.searchParams.set('date', ymd(d));
  history.replaceState(null, '', url.pathname + url.search);
}
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export function weekStart(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(d, -dow);
}

export type RosterGroup = 'available' | 'assigned' | 'unavailable';

export function crewGroups(data: BoardData, day: Date) {
  const key = ymd(day);
  const onJob = new Set(data.assignments.map((a) => a.crew_member_id));
  const off = new Set(data.timeOff.filter((t) => t.start_date <= key && t.end_date >= key).map((t) => t.crew_member_id));
  const groups: Record<RosterGroup, BoardData['crew']> = { available: [], assigned: [], unavailable: [] };
  for (const c of data.crew) {
    if (!c.active) continue;
    if (off.has(c.id)) groups.unavailable.push(c);
    else if (onJob.has(c.id)) groups.assigned.push(c);
    else groups.available.push(c);
  }
  return groups;
}

export function assetGroups(data: BoardData) {
  const onJob = new Set(data.jobAssets.map((a) => a.asset_id));
  const groups: Record<RosterGroup, BoardData['assets']> = { available: [], assigned: [], unavailable: [] };
  for (const a of data.assets) {
    if (!a.active || a.status !== 'in_service') groups.unavailable.push(a);
    else if (onJob.has(a.id)) groups.assigned.push(a);
    else groups.available.push(a);
  }
  return groups;
}

const key = (c: Conflict) => `${c.code}|${c.message}`;
/** Conflicts on `jobId` in `after` that weren't in `before`. */
export function newConflicts(before: Conflict[], after: Conflict[], jobId: string): Conflict[] {
  const had = new Set(before.filter((c) => c.job_id === jobId).map(key));
  return after.filter((c) => c.job_id === jobId && !had.has(key(c)));
}

/**
 * Keyboard drag: arrow keys jump between drop zones (roster, then each job column)
 * instead of nudging pixels, so a keyboard user reaches any job in a few presses.
 */
export function makeKeyboardGetter(order: () => UniqueIdentifier[]): KeyboardCoordinateGetter {
  return (event, { currentCoordinates, context }) => {
    const rect = context.collisionRect;
    const ids = order().filter((id) => context.droppableRects.has(id));
    if (!rect || !ids.length) return;
    const forward = event.code === KeyboardCode.Right || event.code === KeyboardCode.Down;
    const back = event.code === KeyboardCode.Left || event.code === KeyboardCode.Up;
    if (!forward && !back) return;
    event.preventDefault();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const current = context.over?.id;
    let idx = current != null ? ids.indexOf(current) : -1;
    if (idx === -1) {
      // nearest zone to where the item is now
      let best = Infinity;
      ids.forEach((id, i) => {
        const r = context.droppableRects.get(id)!;
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + Math.min(r.height, 200) / 2 - cy);
        if (d < best) {
          best = d;
          idx = i;
        }
      });
      if (forward && idx < ids.length - 1 && current == null) idx = Math.max(idx, -1);
    }
    const next = Math.min(ids.length - 1, Math.max(0, idx + (forward ? 1 : -1)));
    const r = context.droppableRects.get(ids[next])!;
    const tx = r.left + r.width / 2;
    const ty = r.top + Math.min(r.height, 160) / 2;
    return { x: currentCoordinates.x + (tx - cx), y: currentCoordinates.y + (ty - cy) };
  };
}
