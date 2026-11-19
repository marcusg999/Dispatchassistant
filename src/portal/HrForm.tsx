import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { brand } from '../brand/brand.config';
import { BODY_MAX, BODY_MIN } from '../shared/domain';
import { hrFieldErrors } from '../shared/validation';
import { generateTrackingCode, hashTrackingCode } from '../shared/tracking';
import { submitSuggestion } from './api';

/**
 * "HR eyes only": a NAMED personal-issue report. Name required, contact optional,
 * no photo. Stored separately from anonymous suggestions; only the HR list can read it.
 */
type Errors = Partial<Record<'full_name' | 'contact' | 'body' | 'form', string>>;

export function HrForm({ onSubmitted }: { onSubmitted: (code: string) => void }) {
  const openedAt = useRef(Date.now());
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const hr = brand.portal.hr;
  const len = body.trim().length;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const honeypot = (new FormData(e.currentTarget).get('website') as string) ?? '';
    const code = generateTrackingCode();
    const tracking_hash = await hashTrackingCode(code);
    const elapsed = Date.now() - openedAt.current;
    const fe = hrFieldErrors({
      full_name: name,
      contact: contact || undefined,
      body,
      tracking_hash,
      website: honeypot,
      elapsed_ms: elapsed,
    });
    if (fe.full_name || fe.contact || fe.body) {
      setErrors({ full_name: fe.full_name, contact: fe.contact, body: fe.body });
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    setSending(true);
    const wait = 3200 - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const form = new FormData();
    form.set('mode', 'hr');
    form.set('full_name', name.trim());
    if (contact.trim()) form.set('contact', contact.trim());
    form.set('body', body.trim());
    form.set('tracking_hash', tracking_hash);
    form.set('website', honeypot);
    form.set('elapsed_ms', String(Date.now() - openedAt.current));
    const result = await submitSuggestion(form);
    setSending(false);
    if (result.ok) onSubmitted(code);
    else {
      setErrors({ form: result.error });
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  }

  const errorList = (['full_name', 'contact', 'body', 'form'] as const).filter((k) => errors[k]);

  return (
    <form onSubmit={onSubmit} noValidate className="fade-in">
      <h2 id="main-heading" tabIndex={-1} className="sr-only">
        {hr.option}
      </h2>

      <p className="hr-notice" role="note">
        <strong>{hr.noun} eyes only.</strong> {hr.notice}
      </p>

      {errorList.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="error-summary lg:ml-[4.5rem]">
          <p className="font-bold">{errors.form ? 'Not sent yet' : 'A couple of things to fix'}</p>
          <ul className="mt-1 list-disc pl-5 text-[0.9375rem]">
            {errorList.map((k) => (
              <li key={k}>
                {k === 'form' ? (
                  errors.form
                ) : (
                  <a className="underline underline-offset-2" href={`#hr-${k}`}>
                    {errors[k]}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="honeypot" aria-hidden="true">
        <label htmlFor="hr-website">Website</label>
        <input id="hr-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="field">
        <span className="field-num" aria-hidden="true">
          01
        </span>
        <div>
          <label htmlFor="hr-full_name" className="field-label">
            Your name <span className="font-normal text-muted">(required)</span>
          </label>
          <p id="hr-name-help" className="field-help">
            So {hr.noun} knows who to follow up with.
          </p>
          <input
            id="hr-full_name"
            className="text-field"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            autoComplete="name"
            maxLength={140}
            aria-required="true"
            aria-invalid={errors.full_name ? true : undefined}
            aria-describedby={`hr-name-help${errors.full_name ? ' hr-name-err' : ''}`}
          />
          {errors.full_name && (
            <p id="hr-name-err" className="error">
              {errors.full_name}
            </p>
          )}
        </div>
      </div>

      <div className="field">
        <span className="field-num" aria-hidden="true">
          02
        </span>
        <div>
          <label htmlFor="hr-contact" className="field-label">
            Phone or email <span className="font-normal text-muted">(optional)</span>
          </label>
          <p id="hr-contact-help" className="field-help">
            Only if you&rsquo;d like {hr.noun} to reach you somewhere other than at work.
          </p>
          <input
            id="hr-contact"
            className="text-field"
            value={contact}
            onChange={(e) => setContact(e.currentTarget.value)}
            maxLength={220}
            aria-invalid={errors.contact ? true : undefined}
            aria-describedby="hr-contact-help"
          />
          {errors.contact && <p className="error">{errors.contact}</p>}
        </div>
      </div>

      <div className="field">
        <span className="field-num" aria-hidden="true">
          03
        </span>
        <div>
          <label htmlFor="hr-body" className="field-label">
            What&rsquo;s going on?
          </label>
          <p id="hr-body-help" className="field-help">
            Share as much or as little as you&rsquo;re comfortable with. {hr.noun} will take it from here.
          </p>
          <textarea
            id="hr-body"
            className="textarea"
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            maxLength={BODY_MAX + 200}
            aria-invalid={errors.body ? true : undefined}
            aria-describedby={`hr-body-help hr-body-count${errors.body ? ' hr-body-err' : ''}`}
          />
          <div className="meta-row">
            <span />
            <span id="hr-body-count" className={`counter ${len > BODY_MAX ? 'over' : ''}`}>
              {len < BODY_MIN && len > 0 ? `${BODY_MIN - len} more` : `${len.toLocaleString()} / ${BODY_MAX.toLocaleString()}`}
            </span>
          </div>
          {errors.body && (
            <p id="hr-body-err" className="error">
              {errors.body}
            </p>
          )}
        </div>
      </div>

      <div className="field !mb-0">
        <span aria-hidden="true" />
        <div>
          <button type="submit" className="btn-primary" disabled={sending}>
            <span>{sending ? 'Sending…' : `Send to ${hr.noun}`}</span>
            {sending ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <svg className="arrow" width="28" height="16" viewBox="0 0 28 16" aria-hidden="true" fill="none">
                <path d="M0 8h25M18 1l7 7-7 7" stroke="currentColor" strokeWidth="2.25" />
              </svg>
            )}
          </button>
          <p className="mt-4 text-[0.875rem] leading-relaxed text-muted">
            You&rsquo;ll get a tracking code next, to see {hr.noun}&rsquo;s reply here.
          </p>
        </div>
      </div>
    </form>
  );
}
