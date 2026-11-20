import { useCallback, useEffect, useState } from 'react';
import { Confirm, ErrorNote, fmtDate, fmtDateTime } from '../../components/ui';
import { Link, navigate } from '../../router';
import { supabase } from '../../supabase';
import { duplicateAsDraft, listRateCards, rateProblems, type RateCardRow } from '../rates/data';
import { SAMPLE_RATES } from '../../../shared/estimate';

type Pending = { kind: 'activate' | 'delete'; card: RateCardRow } | null;

const today = () => new Date().toLocaleDateString('en-CA');

export function RateCards({ isAdmin }: { isAdmin: boolean }) {
  const [cards, setCards] = useState<RateCardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [effective, setEffective] = useState(today());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listRateCards()
      .then(setCards)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const duplicate = (c: RateCardRow) =>
    run(async () => {
      const id = await duplicateAsDraft(c);
      navigate(`/admin/estimates/rates/${id}`);
    });

  const startFromSample = () =>
    run(async () => {
      const id = await duplicateAsDraft({ name: 'SAMPLE rates', rates: SAMPLE_RATES as never, is_sample: true });
      navigate(`/admin/estimates/rates/${id}`);
    });

  const markReviewed = (c: RateCardRow) =>
    run(async () => {
      const { error: err } = await supabase.rpc('mark_rate_card_reviewed', { p_card: c.id });
      if (err) throw new Error(err.message);
      setNotice(`${c.name} marked reviewed.`);
      load();
    });

  const activate = () =>
    run(async () => {
      if (!pending) return;
      const probs = rateProblems(pending.card.rates);
      if (probs.length) throw new Error(`This card has problems and cannot be activated: ${probs.slice(0, 3).join('; ')}`);
      const { error: err } = await supabase.rpc('activate_rate_card', { p_card: pending.card.id, p_effective: effective });
      if (err) throw new Error(err.message);
      setNotice(`${pending.card.name} is now the active rate card. New estimates use it from ${fmtDate(effective)}.`);
      setPending(null);
      load();
    });

  const remove = () =>
    run(async () => {
      if (!pending) return;
      const { error: err } = await supabase.from('rate_cards').delete().eq('id', pending.card.id).eq('status', 'draft');
      if (err) throw new Error(err.message);
      setNotice('Draft deleted.');
      setPending(null);
      load();
    });

  return (
    <div>
      <h1 className="text-2xl font-[800] tracking-tight">Rate cards</h1>
      <p className="mt-1 max-w-3xl text-muted">
        A rate card holds every price the estimate engine uses. Only a draft can be edited; the active card is locked so quoted prices stay explainable.
        To change prices: duplicate the active card as a draft, edit it, review the live preview, then activate it.
      </p>
      <ErrorNote error={error} />
      {notice && (
        <p role="status" className="mt-2 border-l-4 border-ink pl-3 font-semibold">
          {notice}
        </p>
      )}
      {cards?.length === 0 && (
        <div className="a-panel mt-4 p-5">
          <p className="font-semibold">There is no rate card yet, so nothing can be priced.</p>
          {isAdmin ? (
            <>
              <p className="mt-1 text-muted">Start from the built-in sample numbers, replace every value with your own rates, then activate and mark it reviewed.</p>
              <button type="button" className="a-btn a-btn-primary mt-3" disabled={busy} onClick={startFromSample}>
                Start from sample rates
              </button>
            </>
          ) : (
            <p className="mt-1 text-muted">Ask an admin to set up the rate card.</p>
          )}
        </div>
      )}
      <div className="a-panel mt-4 overflow-x-auto">
        <table className="a-table">
          <caption className="sr-only">Rate cards</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">Effective from</th>
              <th scope="col">Reviewed</th>
              {isAdmin && (
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="[&_tr]:!cursor-default">
            {cards?.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/admin/estimates/rates/${c.id}`} className="font-semibold underline">
                    {c.name}
                  </Link>
                  {c.is_sample && <span className="tag-chip tag-urgent ml-2">Sample</span>}
                  <span className="mt-0.5 block text-[0.75rem] text-muted">Created {fmtDateTime(c.created_at)}</span>
                </td>
                <td>
                  <span className="status-pill">{c.status}</span>
                </td>
                <td>{c.effective_from ? fmtDate(c.effective_from) : <span className="text-muted">Not set</span>}</td>
                <td>
                  {c.reviewed_at ? (
                    <>
                      {c.reviewed_by}
                      <span className="block text-[0.75rem] text-muted">{fmtDate(c.reviewed_at)}</span>
                    </>
                  ) : (
                    <span className="font-semibold">Not reviewed</span>
                  )}
                </td>
                {isAdmin && (
                  <td>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" className="a-btn a-btn-sm" disabled={busy} onClick={() => duplicate(c)}>
                        Duplicate as new draft
                      </button>
                      {c.status === 'draft' && (
                        <>
                          <button type="button" className="a-btn a-btn-sm a-btn-primary" disabled={busy} onClick={() => { setEffective(today()); setPending({ kind: 'activate', card: c }); }}>
                            Activate…
                          </button>
                          <button type="button" className="a-btn a-btn-sm a-btn-danger" disabled={busy} onClick={() => setPending({ kind: 'delete', card: c })}>
                            Delete draft
                          </button>
                        </>
                      )}
                      {c.status === 'active' && !c.reviewed_at && (
                        <button type="button" className="a-btn a-btn-sm a-btn-accent" disabled={busy} onClick={() => markReviewed(c)}>
                          Mark reviewed
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {cards?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
                  No rate cards yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!isAdmin && <p className="mt-3 text-muted">Rate cards are read-only for estimators. Ask an admin to change rates.</p>}

      <Confirm
        open={pending?.kind === 'activate'}
        title={`Activate “${pending?.card.name ?? ''}”?`}
        confirmLabel="Activate"
        disabled={busy || !effective}
        onConfirm={activate}
        onCancel={() => setPending(null)}
      >
        <p>This becomes the card used for all new estimates. The current active card is archived (kept for history). Estimates already in progress keep the rates they were priced with.</p>
        <label htmlFor="eff-date" className="a-label mt-3">
          Effective from (date)
        </label>
        <input id="eff-date" type="date" className="a-input" value={effective} onChange={(e) => setEffective(e.currentTarget.value)} />
      </Confirm>
      <Confirm
        open={pending?.kind === 'delete'}
        title={`Delete “${pending?.card.name ?? ''}”?`}
        confirmLabel="Delete draft"
        danger
        disabled={busy}
        onConfirm={remove}
        onCancel={() => setPending(null)}
      >
        <p>This draft and its changes are removed permanently. Active and archived cards can never be deleted.</p>
      </Confirm>
    </div>
  );
}
