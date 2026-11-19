import { useState } from 'react';
import { brand } from '../brand/brand.config';
import { forgetCode, rememberCode } from './storage';

interface Props {
  code: string;
  onAnother: () => void;
  onCheck: () => void;
}

/** The success moment: the tracking code arrives on a swinging crate tag. */
export function Success({ code, onAnother, onCheck }: Props) {
  const [copied, setCopied] = useState(false);
  const [remember, setRemember] = useState(false);
  const parts = code.split('-');
  const digits = parts.pop();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be blocked; select the text so a long-press copy works.
      const el = document.getElementById('code-text');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  function toggleRemember(on: boolean) {
    setRemember(on);
    if (on) rememberCode(code);
    else forgetCode(code);
  }

  return (
    <section className="fade-in" aria-labelledby="main-heading">
      <p className="stencil text-[0.75rem] text-accent-text">Received</p>
      <h2 id="main-heading" tabIndex={-1} className="mt-2 text-[2rem] font-[800] leading-[1.05] tracking-tight lg:text-[2.5rem]">
        Sent. Thank you.
      </h2>
      <p className="mt-3 max-w-[34rem] text-[1.0625rem] leading-relaxed">
        Here is your tracking code. <strong>Save it now.</strong> It can&rsquo;t be recovered, because nobody,
        including {brand.officeNoun}, knows which code is yours.
      </p>

      <div className="tag-stage mt-14">
        <div className="crate-tag">
          <span className="crate-tag-string" aria-hidden="true" />
          <div className="crate-tag-body">
            <span className="crate-tag-hole" aria-hidden="true" />
            <div className="handling" aria-hidden="true">
              <span className="stencil text-[0.6875rem]">Tracking code</span>
              <svg width="40" height="22" viewBox="0 0 40 22" fill="none">
                <path d="M10 21V3M3 10l7-7 7 7M30 21V3M23 10l7-7 7 7" stroke="currentColor" strokeWidth="2.5" />
              </svg>
            </div>
            <hr className="crate-tag-rule" />
            <p id="code-text" className="code-lines" aria-label={code.split('-').join(' ')}>
              {parts.map((p, i) => (
                <span key={i}>{p}</span>
              ))}
              <span className="code-digits">{digits}</span>
            </p>
            <hr className="crate-tag-rule" />
            <p className="stencil text-[0.6875rem]" aria-hidden="true">
              Keep this · Not recoverable
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-[22rem] flex-col gap-3">
        <button type="button" className="btn-secondary w-full" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy code'}
        </button>
        <span className="sr-only" role="status">
          {copied ? 'Tracking code copied' : ''}
        </span>
        <label className="switch">
          <input type="checkbox" checked={remember} onChange={(e) => toggleRemember(e.currentTarget.checked)} />
          <span>
            Remember this code on this device
            <span className="block text-[0.8125rem] text-muted">Off by default. Anyone using this phone could see it.</span>
          </span>
        </label>
      </div>

      <div className="mt-10 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-5">
        <button type="button" className="btn-ghost" onClick={onCheck}>
          Check status
        </button>
        <button type="button" className="btn-ghost" onClick={onAnother}>
          Send another suggestion
        </button>
      </div>
    </section>
  );
}
