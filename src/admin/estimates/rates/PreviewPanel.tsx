import { useMemo } from 'react';
import { computeEstimate, formatCents, type CrewRule, type PackingRule, type Rates } from '../../../shared/estimate';
import { PREVIEW_SAMPLES } from './previewSamples';

type Priced = { total: number; margin_bp: number; warnings: string[] } | { error: string };

function price(rates: Rates, packing: PackingRule[], crew: CrewRule[], i: number): Priced {
  try {
    const r = computeEstimate(PREVIEW_SAMPLES[i].input, { rates, packing_rules: packing, crew_rules: crew });
    return { total: r.totals.total_cents, margin_bp: r.totals.margin_bp, warnings: r.warnings };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const cell = (p: Priced) => ('error' in p ? <span className="text-danger">Could not price: {p.error}</span> : <span className="tabular-nums">{formatCents(p.total)}</span>);
const margin = (p: Priced) => ('error' in p ? '' : `${(p.margin_bp / 100).toFixed(1)}% margin`);

/** Prices three sample jobs with this card and with the active card, side by side. */
export function PreviewPanel({ card, active, valid, packing, crew }: { card: Rates; active: Rates | null; valid: boolean; packing: PackingRule[]; crew: CrewRule[] }) {
  const rows = useMemo(
    () =>
      valid
        ? PREVIEW_SAMPLES.map((s, i) => ({ s, mine: price(card, packing, crew, i), theirs: active ? price(active, packing, crew, i) : null }))
        : [],
    [card, active, valid, packing, crew],
  );
  return (
    <section className="a-panel p-5" aria-labelledby="preview-h">
      <h2 id="preview-h" className="text-lg font-bold">
        Live preview
      </h2>
      <p className="mt-1 max-w-3xl text-muted">Three sample jobs priced with the numbers on this page. Totals include insurance, minimums and tax, using today&rsquo;s packing and crew rules.</p>
      {!valid ? (
        <p className="mt-3 font-semibold">Fix the problems listed above to see the preview.</p>
      ) : (
        <div className="mt-3 overflow-x-auto border border-line">
          <table className="a-table">
            <caption className="sr-only">Sample job totals, this card compared with the active card</caption>
            <thead>
              <tr>
                <th scope="col">Sample job</th>
                <th scope="col">Active card</th>
                <th scope="col">This card</th>
                <th scope="col">Difference</th>
              </tr>
            </thead>
            <tbody className="[&_tr]:!cursor-default">
              {rows.map(({ s, mine, theirs }) => {
                const diff = theirs && !('error' in theirs) && !('error' in mine) ? mine.total - theirs.total : null;
                return (
                  <tr key={s.key}>
                    <th scope="row" className="text-left">
                      <span className="font-semibold">{s.label}</span>
                      <span className="block text-[0.75rem] font-normal text-muted">{s.detail}</span>
                    </th>
                    <td>
                      {theirs ? cell(theirs) : <span className="text-muted">No active card</span>}
                      {theirs && <span className="block text-[0.75rem] text-muted">{margin(theirs)}</span>}
                    </td>
                    <td>
                      {cell(mine)}
                      <span className="block text-[0.75rem] text-muted">{margin(mine)}</span>
                    </td>
                    <td className="tabular-nums">
                      {diff === null ? '' : diff === 0 ? 'No change' : <strong>{diff > 0 ? `▲ +${formatCents(diff)}` : `▼ ${formatCents(diff)}`}</strong>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
