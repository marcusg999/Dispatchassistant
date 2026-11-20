import { useCallback, useEffect, useRef, useState } from 'react';
import { displayName } from '../brand/brand.config';
import { dayText, dimsText, groupLines, money, qtyText, quoteFileBase, quoteLabel, stopKindText, type QuoteDoc } from '../shared/quote/model';
import { acceptQuote, declineQuote, loadQuote, quoteToken, type LoadResult } from './api';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
};

export function App() {
  const token = quoteToken();
  const [state, setState] = useState<LoadResult | { kind: 'loading' }>({ kind: 'loading' });
  const [declined, setDeclined] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    setState(await loadQuote(token));
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.getElementById('main-heading')?.focus({ preventScroll: true });
  }, [state.kind]);

  return (
    <div className="quote">
      <a href="#main-heading" className="q-skip">
        Skip to quote
      </a>
      <header className="q-brand">
        <span className="q-wordmark">{displayName()}</span>
        {state.kind === 'ok' && <span className="q-ref">{quoteLabel(state.quote)}</span>}
      </header>
      <main className="q-main" aria-busy={state.kind === 'loading'}>
        {state.kind === 'loading' && (
          <p role="status" className="q-quiet">
            Loading your quote…
          </p>
        )}
        {state.kind === 'gone' && (
          <Notice title="This quote isn’t available">
            This quote link isn’t available. It may have expired or been replaced. Please contact us for a current quote.
          </Notice>
        )}
        {state.kind === 'updating' && (
          <Notice title="This quote is being updated">
            {state.message}
            <button type="button" className="q-btn q-btn-ghost q-mt" onClick={() => void load()}>
              Try again
            </button>
          </Notice>
        )}
        {state.kind === 'error' && (
          <Notice title="We couldn’t load the quote">
            {state.message}
            <button type="button" className="q-btn q-btn-ghost q-mt" onClick={() => void load()}>
              Try again
            </button>
          </Notice>
        )}
        {state.kind === 'ok' && <QuoteView token={token} quote={state.quote} superseded={state.superseded} declined={declined} onDeclined={() => setDeclined(true)} reload={() => void load()} />}
      </main>
      <footer className="q-foot">
        <span>{displayName()}</span>
        <span className="q-foot-note">Questions about this quote? Reply to the message that brought you here.</span>
      </footer>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="q-notice-page">
      <h1 id="main-heading" tabIndex={-1} className="q-title">
        {title}
      </h1>
      <p className="q-lede">{children}</p>
    </section>
  );
}

function QuoteView({ token, quote: q, superseded, declined, onDeclined, reload }: { token: string; quote: QuoteDoc; superseded: boolean; declined: boolean; onDeclined: () => void; reload: () => void }) {
  const isDeclined = declined || q.status === 'declined';
  const isAccepted = q.status === 'accepted';
  const open = q.status === 'sent' && !superseded && !isDeclined;
  const groups = groupLines(q.lines);

  return (
    <article aria-labelledby="main-heading">
      {superseded && !isAccepted && (
        <div role="status" className="q-banner q-banner-warn">
          <strong>A newer version of this quote was sent.</strong> Please use the most recent link we sent you. Accepting is turned off on this older version.
        </div>
      )}
      {isAccepted && (
        <div role="status" className="q-banner q-banner-ok">
          <strong>
            Accepted by {q.accepted?.name ?? 'the client'}
            {q.accepted?.at ? ` on ${when(q.accepted.at)}` : ''}.
          </strong>{' '}
          Thank you. We’ll be in touch to confirm scheduling.
        </div>
      )}
      {isDeclined && !isAccepted && (
        <div role="status" className="q-banner">
          <strong>This quote was declined.</strong> If that was a mistake or you’d like changes, please contact us and we’ll send a new one.
        </div>
      )}

      <p className="q-eyebrow">{quoteLabel(q)}</p>
      <h1 id="main-heading" tabIndex={-1} className="q-title">
        {q.title}
      </h1>

      <dl className="q-facts">
        {q.client && <Fact k="Prepared for" v={q.client} />}
        {q.contact && <Fact k="Attention" v={q.contact} />}
        {q.requestedDate && <Fact k="Requested date" v={dayText(q.requestedDate)} />}
        {q.validUntil && <Fact k="Valid until" v={dayText(q.validUntil)} />}
      </dl>

      {q.stops.length > 0 && (
        <section aria-labelledby="h-route" className="q-section">
          <h2 id="h-route" className="q-h2">
            Route
          </h2>
          <ol className="q-stops">
            {q.stops.map((s, i) => (
              <li key={i}>
                <span className="q-stop-kind">{stopKindText(s.kind)}</span>
                <span>{[s.site, s.address].filter(Boolean).join(', ')}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {q.items.length > 0 && (
        <section aria-labelledby="h-items" className="q-section">
          <h2 id="h-items" className="q-h2">
            Works
          </h2>
          <ul className="q-items">
            {q.items.map((it, i) => (
              <li key={i} className="q-item">
                <p className="q-item-name">
                  {it.description}
                  {it.quantity > 1 && <span className="q-item-qty"> ×{it.quantity}</span>}
                </p>
                {(it.artist || it.medium) && <p className="q-item-sub">{[it.artist, it.medium].filter(Boolean).join(' · ')}</p>}
                <p className="q-item-sub">{[dimsText(it), it.packing ? `Packing: ${it.packing}` : ''].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="h-est" className="q-section">
        <h2 id="h-est" className="q-h2">
          Estimate
        </h2>
        <table className="q-table">
          <caption className="q-sr">Quote lines, grouped by category</caption>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className="q-num q-wide">
                Qty
              </th>
              <th scope="col" className="q-num q-wide">
                Unit price
              </th>
              <th scope="col" className="q-num">
                Amount
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.category}>
              <tr className="q-group">
                <th scope="rowgroup" colSpan={4}>
                  {g.label}
                </th>
              </tr>
              {g.lines.map((l, i) => {
                const single = l.qty === 1 && (l.unit === 'each' || l.unit === '');
                const qtyTxt = `${qtyText(l.qty)}${l.unit ? ` ${l.unit}` : ''}`;
                return (
                  <tr key={i} className={l.amountCents < 0 ? 'q-discount' : undefined}>
                    <th scope="row">
                      {l.description}
                      {!single && (
                        <span className="q-sub">
                          {qtyTxt} × {money(l.unitPriceCents)}
                        </span>
                      )}
                    </th>
                    <td className="q-num q-wide">{single ? '' : qtyTxt}</td>
                    <td className="q-num q-wide">{single ? '' : money(l.unitPriceCents)}</td>
                    <td className="q-num q-amt">{money(l.amountCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>

        <dl className="q-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{money(q.totals.subtotalCents)}</dd>
          </div>
          {q.totals.discountCents !== 0 && (
            <div>
              <dt>Discount</dt>
              <dd>{money(-Math.abs(q.totals.discountCents))}</dd>
            </div>
          )}
          {q.totals.taxCents !== 0 && (
            <div>
              <dt>Tax</dt>
              <dd>{money(q.totals.taxCents)}</dd>
            </div>
          )}
          <div className="q-grand">
            <dt>Total</dt>
            <dd>{money(q.totals.totalCents)}</dd>
          </div>
        </dl>
      </section>

      {q.notes.trim() && (
        <section aria-labelledby="h-notes" className="q-section">
          <h2 id="h-notes" className="q-h2">
            Notes
          </h2>
          <p className="q-prose">{q.notes}</p>
        </section>
      )}

      {q.terms && (
        <section aria-labelledby="h-terms" className="q-section">
          <h2 id="h-terms" className="q-h2">
            {q.terms.title} <span className="q-ver">version {q.terms.version}</span>
          </h2>
          <div className="q-terms" role="region" aria-labelledby="h-terms" tabIndex={0}>
            {q.terms.body}
          </div>
        </section>
      )}

      <DownloadPdf quote={q} />

      {open && <Respond token={token} quote={q} reload={reload} onDeclined={onDeclined} />}
    </article>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function DownloadPdf({ quote }: { quote: QuoteDoc }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const { generateQuotePdf } = await import('../shared/quote/pdf');
      const bytes = await generateQuotePdf(quote);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${quoteFileBase(quote)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setErr('We couldn’t build the PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="q-download">
      <button type="button" className="q-btn q-btn-ghost" onClick={run} disabled={busy}>
        {busy ? 'Preparing PDF…' : 'Download PDF'}
      </button>
      {err && (
        <p role="alert" className="q-error">
          {err}
        </p>
      )}
    </div>
  );
}

function Respond({ token, quote: q, reload, onDeclined }: { token: string; quote: QuoteDoc; reload: () => void; onDeclined: () => void }) {
  const [mode, setMode] = useState<'form' | 'confirm' | 'decline'>('form');
  const [f, setF] = useState({ name: '', title: '', email: '', signature: '', agree: false });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: k === 'agree' ? e.currentTarget.checked : e.currentTarget.value }));

  const sigState = !f.signature.trim() ? 'empty' : norm(f.signature) === norm(f.name) && f.name.trim().length >= 2 ? 'match' : 'differ';
  const terms = q.terms;

  useEffect(() => {
    if (mode !== 'form') panel.current?.focus();
  }, [mode]);

  function review(e: React.FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError('Enter your full name.');
    if (!EMAIL.test(f.email.trim())) return setError('Enter a valid email address.');
    if (sigState !== 'match') return setError('Type your full name exactly as entered above to sign.');
    if (!f.agree) return setError('Please agree to the terms.');
    setError(null);
    setMode('confirm');
  }

  async function submit() {
    if (!terms) return;
    setBusy(true);
    setError(null);
    const r = await acceptQuote(token, { name: f.name.trim(), title: f.title.trim(), email: f.email.trim(), signature: f.signature.trim(), agree: true, terms_version_id: terms.id });
    setBusy(false);
    if (r.ok) return reload();
    setError(r.error);
    if (r.code === 'superseded' || r.code === 'terms_changed' || r.code === 'already_accepted') reload();
    else setMode('form');
  }

  async function decline() {
    setBusy(true);
    setError(null);
    const r = await declineQuote(token, reason.trim());
    setBusy(false);
    if (r.ok) {
      onDeclined();
      return reload();
    }
    setError(r.error);
  }

  if (!terms) {
    return (
      <section className="q-section q-respond" aria-labelledby="h-resp">
        <h2 id="h-resp" className="q-h2">
          Accept this quote
        </h2>
        <p className="q-prose">Online acceptance isn’t available for this quote. Please contact us to accept it.</p>
      </section>
    );
  }

  return (
    <section className="q-section q-respond" aria-labelledby="h-resp">
      <h2 id="h-resp" className="q-h2">
        {mode === 'decline' ? 'Decline this quote' : 'Accept this quote'}
      </h2>

      {mode === 'form' && (
        <form onSubmit={review} noValidate>
          <div className="q-field">
            <label htmlFor="f-name">Full name</label>
            <input id="f-name" className="q-input" autoComplete="name" value={f.name} onChange={set('name')} maxLength={120} required />
          </div>
          <div className="q-field">
            <label htmlFor="f-title">
              Title <span className="q-opt">(optional)</span>
            </label>
            <input id="f-title" className="q-input" autoComplete="organization-title" value={f.title} onChange={set('title')} maxLength={120} />
          </div>
          <div className="q-field">
            <label htmlFor="f-email">Email</label>
            <input id="f-email" type="email" className="q-input" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} maxLength={200} required />
          </div>
          <div className="q-field">
            <label htmlFor="f-sig">Signature (type your name to sign)</label>
            <input id="f-sig" className="q-input q-sig" autoComplete="off" autoCapitalize="words" spellCheck={false} value={f.signature} onChange={set('signature')} maxLength={120} required aria-describedby="sig-hint" />
            <p id="sig-hint" className={`q-hint ${sigState === 'match' ? 'q-hint-ok' : ''}`} aria-live="polite">
              {sigState === 'empty' && 'Type your name again exactly as above to sign.'}
              {sigState === 'match' && '✓ Signature matches your name.'}
              {sigState === 'differ' && 'Doesn’t match the name above yet.'}
            </p>
          </div>
          <label className="q-check">
            <input type="checkbox" checked={f.agree} onChange={set('agree')} />
            <span>I agree to the terms (version {terms.version})</span>
          </label>
          <p className="q-notice">
            <strong>Accepting creates a named business record:</strong> your name, email, the time, your IP address and browser are saved with this acceptance.
          </p>
          {error && (
            <p role="alert" className="q-error">
              {error}
            </p>
          )}
          <div className="q-actions">
            <button type="submit" className="q-btn q-btn-primary">
              Review and accept
            </button>
            <button
              type="button"
              className="q-btn q-btn-ghost"
              onClick={() => {
                setError(null);
                setMode('decline');
              }}
            >
              Decline this quote
            </button>
          </div>
        </form>
      )}

      {mode === 'confirm' && (
        <div ref={panel} tabIndex={-1} className="q-confirm" role="group" aria-labelledby="h-confirm">
          <p id="h-confirm" className="q-confirm-q">
            Accept quote for {money(q.totals.totalCents)}?
          </p>
          <p className="q-prose">
            Signed as <strong>{f.name.trim()}</strong> ({f.email.trim()}). This is recorded with the time, your IP address and browser.
          </p>
          {error && (
            <p role="alert" className="q-error">
              {error}
            </p>
          )}
          <div className="q-actions">
            <button type="button" className="q-btn q-btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Accepting…' : `Yes, accept quote for ${money(q.totals.totalCents)}`}
            </button>
            <button type="button" className="q-btn q-btn-ghost" onClick={() => setMode('form')} disabled={busy}>
              Go back
            </button>
          </div>
        </div>
      )}

      {mode === 'decline' && (
        <div ref={panel} tabIndex={-1} className="q-confirm">
          <div className="q-field">
            <label htmlFor="f-reason">
              Reason <span className="q-opt">(optional)</span>
            </label>
            <textarea id="f-reason" className="q-input q-textarea" value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={1000} />
          </div>
          {error && (
            <p role="alert" className="q-error">
              {error}
            </p>
          )}
          <p className="q-confirm-q">Decline this quote?</p>
          <div className="q-actions">
            <button type="button" className="q-btn q-btn-danger" onClick={() => void decline()} disabled={busy}>
              {busy ? 'Declining…' : 'Yes, decline'}
            </button>
            <button type="button" className="q-btn q-btn-ghost" onClick={() => setMode('form')} disabled={busy}>
              Go back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
