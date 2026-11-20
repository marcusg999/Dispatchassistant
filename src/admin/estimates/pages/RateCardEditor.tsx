import { useCallback, useEffect, useMemo, useState } from 'react';
import { ratesSchema, type CrewRule, type PackingRule, type Rates } from '../../../shared/estimate';
import { ErrorNote, fmtDate } from '../../components/ui';
import { Link, navigate } from '../../router';
import { supabase } from '../../supabase';
import { duplicateAsDraft, getActiveRateCard, getRateCard, loadRules, rateProblems, type RateCardRow } from '../rates/data';
import { diffLeaves, kindForPath, pathLabel, same, setAt } from '../rates/diff';
import { EditorContext } from '../rates/fields';
import { PreviewPanel } from '../rates/PreviewPanel';
import { displayStored } from '../rates/scaled';
import { RateSections, SECTION_IDS } from '../rates/sections';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function RateCardEditor({ id, isAdmin }: { id: string; isAdmin: boolean }) {
  const [card, setCard] = useState<RateCardRow | null | undefined>(undefined);
  const [active, setActive] = useState<RateCardRow | null>(null);
  const [rules, setRules] = useState<{ packing: PackingRule[]; crew: CrewRule[] }>({ packing: [], crew: [] });
  const [draft, setDraft] = useState<Rates | null>(null);
  const [name, setName] = useState('');
  const [compare, setCompare] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showProblems, setShowProblems] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, a, r] = await Promise.all([getRateCard(id), getActiveRateCard(), loadRules()]);
      setCard(c);
      setActive(a);
      setRules(r);
      if (c) {
        setDraft(clone(c.rates));
        setName(c.name);
      }
    } catch (e) {
      setError((e as Error).message);
      setCard(null);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const editable = isAdmin && card?.status === 'draft';
  const base = compare && active && card && active.id !== card.id ? active.rates : null;
  const problems = useMemo(() => (draft ? rateProblems(draft) : []), [draft]);
  const nameProblem = name.trim().length < 2 ? 'Give the card a name (at least 2 characters).' : null;
  const dirty = card && draft ? name !== card.name || !same(draft, card.rates) : false;
  const changes = useMemo(() => (draft && active && card && active.id !== card.id ? diffLeaves(active.rates, draft) : []), [draft, active, card]);

  const ctx = useMemo(
    () =>
      draft
        ? {
            draft,
            base,
            editable,
            set: (path: string, value: unknown) =>
              setDraft((d) => {
                if (!d) return d;
                const n = clone(d);
                setAt(n, path, value);
                return n;
              }),
            mutate: (fn: (d: Rates) => void) =>
              setDraft((d) => {
                if (!d) return d;
                const n = clone(d);
                fn(n);
                return n;
              }),
          }
        : null,
    [draft, base, editable],
  );

  async function save() {
    if (!draft || !card) return;
    setShowProblems(true);
    setSaved(null);
    setError(null);
    const parsed = ratesSchema.safeParse(draft);
    if (!parsed.success || nameProblem) {
      setError('Not saved: fix the problems listed below, then save again.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.from('rate_cards').update({ name: name.trim(), rates: parsed.data as never }).eq('id', card.id);
    setBusy(false);
    if (err) return setError(err.message);
    setSaved('Saved. Estimates already in progress keep the rates they were priced with.');
    setShowProblems(false);
    await load();
  }

  async function duplicate() {
    if (!card) return;
    setBusy(true);
    try {
      const newId = await duplicateAsDraft({ name: card.name, rates: card.rates, is_sample: card.is_sample });
      navigate(`/admin/estimates/rates/${newId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (card === undefined) return <p className="text-muted">Loading…</p>;
  if (card === null || !draft || !ctx) return <><ErrorNote error={error} /><p className="text-muted">Rate card not found. <Link href="/admin/estimates/rates" className="underline">Back to rate cards</Link></p></>;

  const canCompare = Boolean(active && active.id !== card.id);

  return (
    <EditorContext.Provider value={ctx}>
      <div className="space-y-6">
        <div>
          <Link href="/admin/estimates/rates" className="text-[0.8125rem] underline">
            {'←'} Rate cards
          </Link>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-[16rem] flex-1">
              {editable ? (
                <>
                  <label htmlFor="card-name" className="a-label">
                    Rate card name
                  </label>
                  <input id="card-name" className="a-input max-w-xl text-lg font-bold" value={name} maxLength={100} onChange={(e) => setName(e.currentTarget.value)} />
                </>
              ) : (
                <h1 className="text-2xl font-[800] tracking-tight">{card.name}</h1>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-2 text-muted">
                <span className="status-pill text-ink">{card.status}</span>
                {card.is_sample && <span className="tag-chip tag-urgent">Sample</span>}
                {card.effective_from && <span>Effective from {fmtDate(card.effective_from)}</span>}
                {card.reviewed_at ? <span>Reviewed by {card.reviewed_by} on {fmtDate(card.reviewed_at)}</span> : <span>Not reviewed</span>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canCompare && (
                <button type="button" className="a-toggle" aria-pressed={compare} onClick={() => setCompare((c) => !c)}>
                  Compare with active card
                </button>
              )}
              {isAdmin && (
                <button type="button" className="a-btn" onClick={duplicate} disabled={busy}>
                  Duplicate as new draft
                </button>
              )}
            </div>
          </div>
        </div>

        {!editable && (
          <p role="note" className="border-l-4 border-ink bg-paper p-3">
            {card.status === 'draft'
              ? 'You can read this draft, but only an admin can edit it.'
              : `This card is ${card.status}, so its rates are locked: prices already quoted must stay explainable. `}
            {isAdmin && card.status !== 'draft' && <>Use <strong>Duplicate as new draft</strong> to make changes, then activate the draft.</>}
          </p>
        )}

        <nav aria-label="Jump to a section" className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem]">
          {SECTION_IDS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="underline">
              {s.title}
            </a>
          ))}
          <a href="#preview-h" className="underline">
            Live preview
          </a>
        </nav>

        {canCompare && compare && (
          <section className="a-panel p-5" aria-labelledby="chg-h">
            <h2 id="chg-h" className="text-lg font-bold">
              Changes compared with the active card ({changes.length})
            </h2>
            <p className="mt-1 text-muted">
              Compared with <strong>{active?.name}</strong>. Changed fields below are marked with a ▲ and show the active value.
            </p>
            {changes.length === 0 ? (
              <p className="mt-3">No differences yet.</p>
            ) : (
              <div className="mt-3 max-h-72 overflow-auto border border-line">
                <table className="a-table">
                  <caption className="sr-only">Every value that differs from the active card</caption>
                  <thead>
                    <tr>
                      <th scope="col">Setting</th>
                      <th scope="col">Active card</th>
                      <th scope="col">This card</th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr]:!cursor-default">
                    {changes.map((c) => {
                      const kind = kindForPath(c.path);
                      const fmt = (v: unknown) => (v === undefined ? '(no such row)' : typeof v === 'object' && v !== null ? (Array.isArray(v) ? v.join(', ') || '(none)' : '(whole row)') : displayStored(v, kind));
                      return (
                        <tr key={c.path}>
                          <th scope="row" className="text-left font-normal">{pathLabel(c.path)}</th>
                          <td className="tabular-nums">{fmt(c.before)}</td>
                          <td className="font-semibold tabular-nums">{fmt(c.after)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <RateSections />

        <PreviewPanel card={draft} active={active?.rates ?? null} valid={problems.length === 0} packing={rules.packing} crew={rules.crew} />

        {(showProblems || problems.length > 0 || nameProblem) && editable && (problems.length > 0 || nameProblem) && (
          <section role="alert" className="border-2 border-danger bg-paper p-4" aria-labelledby="prob-h">
            <h2 id="prob-h" className="font-bold text-danger">
              {problems.length + (nameProblem ? 1 : 0)} problem{problems.length + (nameProblem ? 1 : 0) === 1 ? '' : 's'} to fix before saving
            </h2>
            <ul className="mt-2 list-disc pl-5">
              {nameProblem && <li>{nameProblem}</li>}
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        )}

        {editable && (
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t-2 border-ink bg-paper p-3">
            <button type="button" className="a-btn a-btn-primary" onClick={save} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
            <span role="status" className="text-[0.8125rem]">
              {saved ?? (dirty ? 'Unsaved changes' : 'All changes saved')}
            </span>
            <ErrorNote error={error} />
          </div>
        )}
        {!editable && <ErrorNote error={error} />}
      </div>
    </EditorContext.Provider>
  );
}
