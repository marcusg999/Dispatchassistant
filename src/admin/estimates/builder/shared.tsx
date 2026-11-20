/** Small shared pieces for the estimates screens: fields, money, status, margin, note dialog, quote link. */
import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { formatCents } from '../../../shared/estimate';
import { STATUS_LABEL, isBelowTarget, type EstimateStatus } from '../data';

/** Label + control + (optional) hint and error, wired with ids so screen readers get all three. */
export function Field({
  label,
  error,
  hint,
  className = '',
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
}) {
  const id = useId();
  const msgId = `${id}-m`;
  const described = error || hint ? msgId : undefined;
  return (
    <div className={className}>
      <label className="a-label" htmlFor={id}>
        {label}
      </label>
      {isValidElement(children) ? cloneElement(children, { id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined }) : children}
      {error ? (
        <p id={msgId} className="est-err">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="est-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Right-aligned money, tabular figures; negatives carry a minus sign. */
export function Money({ cents, className = '' }: { cents: number; className?: string }) {
  return <span className={`est-money ${className}`}>{formatCents(cents)}</span>;
}

export const pct = (bp: number) => `${(bp / 100).toFixed(1)}%`;

export function StatusPill({ status }: { status: string }) {
  return <span className={`est-status est-status-${status}`}>{STATUS_LABEL[status as EstimateStatus] ?? status}</span>;
}

/** Margin as a percentage with a text label (never color alone). */
export function MarginBadge({ margin_bp, target_bp, total_cents }: { margin_bp: number; target_bp: string | number | null; total_cents: number }) {
  if (total_cents <= 0) return <span className="est-money text-muted">—</span>;
  const below = isBelowTarget({ margin_bp, target_bp, total_cents });
  return (
    <span className="est-margin">
      <span className="est-money">{pct(margin_bp)}</span>
      <span className={below ? 'est-margin-flag est-margin-low' : 'est-margin-flag est-margin-ok'}>{below ? '▼ Below target' : '● On target'}</span>
    </span>
  );
}

/** Dialog that collects a note (required or optional) before an action. */
export function NoteDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  minLength = 0,
  danger,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  label: string;
  confirmLabel: string;
  minLength?: number;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const tid = useId();
  const nid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setNote('');
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  const short = note.trim().length < minLength;
  return (
    <dialog ref={ref} className="a-dialog" onClose={onCancel} aria-labelledby={tid}>
      <h2 id={tid} className="text-lg font-bold">
        {title}
      </h2>
      {description ? <div className="mt-2 text-[0.9375rem] leading-relaxed">{description}</div> : null}
      <div className="mt-3">
        <label className="a-label" htmlFor={nid}>
          {label}
          {minLength > 0 ? ' (required)' : ' (optional)'}
        </label>
        <textarea id={nid} className="a-textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>
      {error ? (
        <p role="alert" className="est-err">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="a-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={`a-btn ${danger ? 'a-btn-danger' : 'a-btn-primary'}`} disabled={busy || short} onClick={() => onSubmit(note.trim())}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** Shown once after a quote link is created. The server stores only a hash, so it can't be shown again. */
export function QuoteLinkPanel({ path, validUntil, onClose }: { path: string; validUntil: string | null; onClose: () => void }) {
  const url = `${location.origin}${path}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="est-linkbox" aria-labelledby="quote-link-h" role="status">
      <h2 id="quote-link-h" className="text-base font-bold">
        Quote link created
      </h2>
      <p className="mt-1">
        This link can’t be shown again. Copy it now{validUntil ? <> (valid until {validUntil})</> : null}. Sending again creates a new link and retires this one.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <label className="a-label" htmlFor="quote-link-url">
            Quote link
          </label>
          <input id="quote-link-url" className="a-input est-mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <button type="button" className="a-btn a-btn-primary" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className="a-btn" onClick={onClose}>
          Done
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {copied ? 'Link copied to the clipboard.' : ''}
      </p>
    </section>
  );
}
