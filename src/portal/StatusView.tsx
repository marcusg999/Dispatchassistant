import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { brand } from '../brand/brand.config';
import { STATUS_HINT, STATUS_LABEL, type Status } from '../shared/domain';
import { hashTrackingCode, looksLikeTrackingCode, normalizeTrackingCode } from '../shared/tracking';
import { fetchStatus, type StatusResponse } from './api';
import { forgetCode, rememberedCodes } from './storage';

const STEPS: Status[] = ['new', 'reviewing', 'planned', 'done'];

export function StatusView({ prefill }: { prefill: string }) {
  const [code, setCode] = useState(prefill);
  const [state, setState] = useState<'idle' | 'loading' | 'not_found' | 'error' | 'invalid'>('idle');
  const [result, setResult] = useState<StatusResponse | null>(null);
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => setSaved(rememberedCodes()), []);

  async function lookup(raw: string) {
    const normalized = normalizeTrackingCode(raw);
    setCode(normalized);
    setResult(null);
    if (!looksLikeTrackingCode(normalized)) {
      setState('invalid');
      return;
    }
    setState('loading');
    const r = await fetchStatus(await hashTrackingCode(normalized));
    if (r === 'not_found' || r === 'error') setState(r);
    else {
      setResult(r);
      setState('idle');
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void lookup(code);
  }

  const idx = result ? (result.status === 'declined' ? -1 : STEPS.indexOf(result.status)) : -1;

  return (
    <section className="fade-in" aria-labelledby="main-heading">
      <h2 id="main-heading" tabIndex={-1} className="text-[2rem] font-[800] leading-[1.05] tracking-tight lg:text-[2.5rem]">
        Check on a suggestion
      </h2>
      <p className="mt-3 max-w-[34rem] text-[1.0625rem] leading-relaxed">
        Enter the tracking code you were given. You&rsquo;ll see where it stands and any reply from {brand.officeNoun}.
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3 sm:flex-row" noValidate>
        <label htmlFor="code" className="sr-only">
          Tracking code
        </label>
        <input
          id="code"
          className="text-input"
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
          placeholder="WORD-WORD-WORD-WORD-1234"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={state === 'invalid' || state === 'not_found' ? true : undefined}
          aria-describedby="code-msg"
        />
        <button type="submit" className="btn-secondary shrink-0 sm:min-w-[8.5rem]" disabled={state === 'loading'}>
          {state === 'loading' ? <span className="spinner" aria-hidden="true" /> : 'Check'}
        </button>
      </form>

      <div id="code-msg" role="status" className="min-h-[1.5rem]">
        {state === 'invalid' && <p className="error">That doesn&rsquo;t look like a tracking code. It&rsquo;s four words and four digits.</p>}
        {state === 'not_found' && <p className="error">No suggestion found for that code. Check the spelling and try again.</p>}
        {state === 'error' && <p className="error">Couldn&rsquo;t check right now. Check your signal and try again.</p>}
      </div>

      {saved.length > 0 && !result && (
        <div className="mt-6">
          <p className="stencil text-[0.6875rem] text-muted">Saved on this device</p>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {saved.map((c) => (
              <li key={c} className="flex items-center justify-between gap-3">
                <button type="button" className="btn-ghost text-left font-[650] tracking-wide no-underline" onClick={() => lookup(c)}>
                  {c}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-[0.8125rem] text-muted"
                  onClick={() => {
                    forgetCode(c);
                    setSaved(rememberedCodes());
                  }}
                  aria-label={`Forget ${c}`}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className="fade-in mt-8 bg-wall p-5 lg:p-7" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[1.5rem] font-[800] tracking-tight">{STATUS_LABEL[result.status]}</p>
            <p className="text-[0.8125rem] text-muted">
              Updated {new Date(result.updated_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </p>
          </div>
          <p className="mt-1 text-muted">{STATUS_HINT[result.status]}</p>

          {result.status !== 'declined' && (
            <ol className="timeline mt-6" aria-label="Progress">
              {STEPS.map((s, i) => (
                <li key={s} className={`${i <= idx ? 'reached' : ''} ${i === idx ? 'current' : ''}`} aria-current={i === idx ? 'step' : undefined}>
                  {STATUS_LABEL[s]}
                </li>
              ))}
            </ol>
          )}

          <div className="label-plate mt-7 !max-w-none !shadow-none">
            <p className="stencil text-[0.6875rem] text-muted">Reply from {brand.officeNoun}</p>
            <p className="mt-2 whitespace-pre-line text-[1.0625rem] leading-relaxed">
              {result.public_reply?.trim() || 'No reply yet.'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
