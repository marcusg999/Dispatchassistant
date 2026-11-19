import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { timeOffSchema, issues } from '../../../shared/dispatch';
import { addTimeOff, deleteTimeOff, listCrew, listTimeOff, type TimeOff } from '../data';
import { ErrorNote } from '../../components/ui';
import { parseYmd, ymd } from '../ui';

type Crew = Awaited<ReturnType<typeof listCrew>>[number];

/** "Unavailable" calendar. Never asks for a reason. */
export function TimeOffPage({ canEdit }: { canEdit: boolean }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [crew, setCrew] = useState<Crew[]>([]);
  const [entries, setEntries] = useState<TimeOff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [partial, setPartial] = useState(false);
  const [form, setForm] = useState({ crew_member_id: '', start_date: ymd(new Date()), end_date: ymd(new Date()), start_time: '', end_time: '', note: '' });

  // Monday-start grid covering the month.
  const days = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);

  async function reload() {
    const [c, t] = await Promise.all([listCrew(), listTimeOff(ymd(days[0]), ymd(days[41]))]);
    setCrew(c);
    setEntries(t);
  }
  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const name = (id: string) => crew.find((c) => c.id === id)?.display_name ?? 'Unknown';
  const onDay = (d: string) => entries.filter((e) => e.start_date <= d && e.end_date >= d);
  const today = ymd(new Date());

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      crew_member_id: form.crew_member_id,
      start_date: form.start_date,
      end_date: form.end_date,
      start_time: partial ? form.start_time || null : null,
      end_time: partial ? form.end_time || null : null,
      note: form.note.trim() || null,
    };
    const errs = issues(timeOffSchema.safeParse(input));
    if (partial && (!form.start_time || !form.end_time)) errs.start_time = 'Enter both times, or untick “Part of the day”.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await addTimeOff(input as Parameters<typeof addTimeOff>[0]);
      setForm((f) => ({ ...f, note: '' }));
      await reload();
    } catch (x) {
      setError((x as Error).message);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-[800] tracking-tight">Time off</h1>
        <button className="a-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
          ←
        </button>
        <span className="min-w-[10rem] text-center font-bold" aria-live="polite">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button className="a-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
          →
        </button>
      </div>
      <p className="mt-1 text-muted">Shows when people are unavailable. No reason is needed or recorded.</p>
      <ErrorNote error={error} />

      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="a-panel overflow-x-auto">
          <table className="cal-grid">
            <thead>
              <tr>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <th key={d} scope="col">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, w) => (
                <tr key={w}>
                  {days.slice(w * 7, w * 7 + 7).map((d) => {
                    const k = ymd(d);
                    const list = onDay(k);
                    return (
                      <td key={k} className={`${d.getMonth() === month.getMonth() ? '' : 'cal-out'} ${k === today ? 'cal-today' : ''}`}>
                        <span className="cal-date">{d.getDate()}</span>
                        <ul>
                          {list.map((t) => (
                            <li key={t.id} className="cal-entry">
                              {name(t.crew_member_id)}
                              {t.start_time && <span className="text-muted"> {t.start_time.slice(0, 5)}–{t.end_time?.slice(0, 5)}</span>}
                            </li>
                          ))}
                        </ul>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="space-y-6">
          {canEdit && (
            <form className="a-panel space-y-3 p-4" onSubmit={onSubmit} noValidate aria-labelledby="to-h">
              <h2 id="to-h" className="text-base font-bold">
                Mark unavailable
              </h2>
              <div>
                <label htmlFor="to-crew" className="a-label">
                  Crew member
                </label>
                <select id="to-crew" className="a-select" value={form.crew_member_id} onChange={(e) => setForm({ ...form, crew_member_id: e.currentTarget.value })}>
                  <option value="">Choose…</option>
                  {crew
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.display_name}
                      </option>
                    ))}
                </select>
                {errors.crew_member_id && <p className="text-danger">{errors.crew_member_id}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="to-start" className="a-label">
                    From
                  </label>
                  <input id="to-start" type="date" className="a-input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.currentTarget.value, end_date: form.end_date < e.currentTarget.value ? e.currentTarget.value : form.end_date })} />
                </div>
                <div>
                  <label htmlFor="to-end" className="a-label">
                    To
                  </label>
                  <input id="to-end" type="date" className="a-input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.currentTarget.value })} />
                </div>
              </div>
              {errors.end_date && <p className="text-danger">{errors.end_date}</p>}
              <label className="flex min-h-[44px] items-center gap-2">
                <input type="checkbox" className="size-4" checked={partial} onChange={(e) => setPartial(e.currentTarget.checked)} />
                Part of the day
              </label>
              {partial && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="to-st" className="a-label">
                      From time
                    </label>
                    <input id="to-st" type="time" className="a-input" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.currentTarget.value })} />
                  </div>
                  <div>
                    <label htmlFor="to-et" className="a-label">
                      To time
                    </label>
                    <input id="to-et" type="time" className="a-input" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.currentTarget.value })} />
                  </div>
                </div>
              )}
              {errors.start_time && <p className="text-danger">{errors.start_time}</p>}
              <div>
                <label htmlFor="to-note" className="a-label">
                  Note (office only)
                </label>
                <input id="to-note" className="a-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.currentTarget.value })} aria-describedby="to-note-hint" />
                <p id="to-note-hint" className="mt-1 text-[0.8125rem] text-muted">
                  Office only — logistics only. Don’t record medical or personal reasons.
                </p>
              </div>
              <button className="a-btn a-btn-primary w-full">Mark unavailable</button>
            </form>
          )}

          <section className="a-panel p-4" aria-labelledby="to-list-h">
            <h2 id="to-list-h" className="text-base font-bold">
              This view
            </h2>
            <ul className="mt-2 divide-y divide-line">
              {entries.length === 0 && <li className="py-2 text-muted">Nobody is unavailable.</li>}
              {entries.map((t) => (
                <li key={t.id} className="flex items-start gap-2 py-2">
                  <div className="flex-1">
                    <p className="font-semibold">{name(t.crew_member_id)}: Unavailable</p>
                    <p className="text-[0.8125rem] text-muted">
                      {parseYmd(t.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      {t.end_date !== t.start_date && ` – ${parseYmd(t.end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                      {t.start_time && ` · ${t.start_time.slice(0, 5)}–${t.end_time?.slice(0, 5)}`}
                    </p>
                    {t.note && <p className="text-[0.8125rem]">{t.note}</p>}
                  </div>
                  {canEdit && (
                    <button className="a-btn a-btn-sm" onClick={async () => (await deleteTimeOff(t.id), reload())} aria-label={`Remove unavailable entry for ${name(t.crew_member_id)}`}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
