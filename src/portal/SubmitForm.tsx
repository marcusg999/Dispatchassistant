import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { brand } from '../brand/brand.config';
import {
  BODY_MAX,
  BODY_MIN,
  CATEGORIES,
  CATEGORY_LABEL,
  TAGS,
  TAG_HINT,
  TAG_LABEL,
  type Category,
  type Tag,
} from '../shared/domain';
import { fieldErrors } from '../shared/validation';
import { generateTrackingCode, hashTrackingCode } from '../shared/tracking';
import { ACCEPTED_INPUT, PhotoError, scrubPhoto } from './photo';
import { submitSuggestion } from './api';

interface Props {
  onSubmitted: (code: string) => void;
}

type Errors = Partial<Record<'body' | 'category' | 'tag' | 'photo' | 'form', string>>;

export function SubmitForm({ onSubmitted }: Props) {
  const openedAt = useRef(Date.now());
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<Category | ''>('');
  const [tag, setTag] = useState<Tag | ''>('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  const len = body.trim().length;

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setErrors((e) => ({ ...e, photo: undefined }));
    try {
      const blob = await scrubPhoto(file);
      setPhoto(blob);
      setPhotoUrl(URL.createObjectURL(blob));
    } catch (err) {
      setPhoto(null);
      setPhotoUrl(null);
      setErrors((e) => ({
        ...e,
        photo: err instanceof PhotoError ? err.message : "That photo couldn't be used. Try another one.",
      }));
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoUrl(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || photoBusy) return;
    const honeypot = (new FormData(e.currentTarget).get('website') as string) ?? '';
    const code = generateTrackingCode();
    const tracking_hash = await hashTrackingCode(code);
    const elapsed = Date.now() - openedAt.current;
    const fields = { body, category, tag, tracking_hash, website: honeypot, elapsed_ms: elapsed };
    const fe = fieldErrors(fields);
    const next: Errors = { body: fe.body, category: fe.category, tag: fe.tag };
    if (next.body || next.category || next.tag) {
      setErrors(next);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    setSending(true);

    // Bot speed bump: a human can't finish this form in under ~3 s. Wait out the remainder quietly.
    const wait = 3200 - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const form = new FormData();
    form.set('body', body.trim());
    form.set('category', category);
    form.set('tag', tag);
    form.set('tracking_hash', tracking_hash);
    form.set('website', honeypot);
    form.set('elapsed_ms', String(Date.now() - openedAt.current));
    if (photo) form.set('photo', photo, photo.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');

    const result = await submitSuggestion(form);
    setSending(false);
    if (result.ok) {
      onSubmitted(code);
    } else {
      setErrors({ form: result.error });
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  }

  const errorList = (['body', 'category', 'tag', 'form'] as const).filter((k) => errors[k]);

  return (
    <form onSubmit={onSubmit} noValidate className="fade-in">
      <h2 id="main-heading" tabIndex={-1} className="sr-only">
        Make a suggestion
      </h2>

      {errorList.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="error-summary">
          <p className="font-bold">{errors.form ? 'Not sent yet' : 'A couple of things to fix'}</p>
          <ul className="mt-1 list-disc pl-5 text-[0.9375rem]">
            {errorList.map((k) => (
              <li key={k}>
                {k === 'form' ? (
                  errors.form
                ) : (
                  <a className="underline underline-offset-2" href={`#f-${k}`}>
                    {errors[k]}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Honeypot: invisible to people and screen readers; bots fill it in. */}
      <div className="honeypot" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="field">
        <span className="field-num" aria-hidden="true">
          01
        </span>
        <div>
          <label htmlFor="f-body" className="field-label">
            What should {brand.officeNoun} know?
          </label>
          <p id="f-body-help" className="field-help">
            A problem, an idea, a near-miss, something that works well. Plain words are perfect.
          </p>
          <textarea
            id="f-body"
            className="textarea"
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            maxLength={BODY_MAX + 200}
            aria-describedby={`f-body-help f-body-tip f-body-count${errors.body ? ' f-body-err' : ''}`}
            aria-invalid={errors.body ? true : undefined}
            placeholder="e.g. The lift gate on the box truck sticks in the cold. Twice this week we had to hand-carry a crate down."
          />
          <div className="meta-row">
            <span id="f-body-tip">
              Tip: very specific details can sometimes point to who wrote something. Keep it general if that matters to
              you.
            </span>
            <span
              id="f-body-count"
              className={`counter ${len > BODY_MAX ? 'over' : ''}`}
              aria-live={len > BODY_MAX - 100 ? 'polite' : 'off'}
            >
              {len < BODY_MIN && len > 0 ? `${BODY_MIN - len} more` : `${len.toLocaleString()} / ${BODY_MAX.toLocaleString()}`}
            </span>
          </div>
          {errors.body && (
            <p id="f-body-err" className="error">
              {errors.body}
            </p>
          )}
        </div>
      </div>

      <fieldset className="field" aria-describedby={errors.category ? 'f-category-err' : undefined}>
        <span className="field-num" aria-hidden="true">
          02
        </span>
        <div>
          <legend className="field-label" id="f-category" tabIndex={-1}>
            What is it about?
          </legend>
          <div className="chips mt-3">
            {CATEGORIES.map((c) => (
              <label key={c} className="chip">
                <input
                  type="radio"
                  name="category"
                  value={c}
                  checked={category === c}
                  onChange={() => setCategory(c)}
                />
                <span>{CATEGORY_LABEL[c]}</span>
              </label>
            ))}
          </div>
          {errors.category && (
            <p id="f-category-err" className="error">
              {errors.category}
            </p>
          )}
        </div>
      </fieldset>

      <fieldset className="field" aria-describedby={errors.tag ? 'f-tag-err' : undefined}>
        <span className="field-num" aria-hidden="true">
          03
        </span>
        <div>
          <legend className="field-label" id="f-tag" tabIndex={-1}>
            How pressing is it?
          </legend>
          <div className="press-list mt-3">
            {TAGS.map((t) => (
              <label key={t} className="press">
                <input
                  type="radio"
                  name="tag"
                  value={t}
                  checked={tag === t}
                  onChange={() => setTag(t)}
                  aria-describedby={`hint-${t}`}
                />
                <span className="press-body">
                  <span className={`press-swatch swatch-${t}`} aria-hidden="true" />
                  <span className="press-text">
                    <span className="press-name">{TAG_LABEL[t]}</span>
                    <span id={`hint-${t}`} className="press-hint">
                      {TAG_HINT[t]}
                    </span>
                  </span>
                  <span className="press-tick" aria-hidden="true" />
                </span>
              </label>
            ))}
          </div>
          {errors.tag && (
            <p id="f-tag-err" className="error">
              {errors.tag}
            </p>
          )}
        </div>
      </fieldset>

      <div className="field">
        <span className="field-num" aria-hidden="true">
          04
        </span>
        <div>
          <span className="field-label" id="f-photo-label">
            Photo <span className="font-normal text-muted">(optional)</span>
          </span>
          <input
            ref={fileRef}
            id="f-photo"
            type="file"
            accept={ACCEPTED_INPUT}
            className="sr-only"
            aria-labelledby="f-photo-label"
            onChange={(e) => onPickPhoto((e.target as HTMLInputElement).files?.[0])}
          />
          <div className="mt-3">
            {photoUrl ? (
              <div className="photo-preview">
                <img src={photoUrl} alt="Your attached photo" />
                <div className="flex flex-col items-start">
                  <span className="text-[0.875rem] text-muted">
                    Location and camera details removed · {Math.round((photo?.size ?? 0) / 1024)} KB
                  </span>
                  <button type="button" className="btn-ghost" onClick={removePhoto}>
                    Remove photo
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="photo-btn"
                onClick={() => fileRef.current?.click()}
                disabled={photoBusy}
                aria-describedby="f-photo-note"
              >
                {photoBusy ? <span className="spinner" aria-hidden="true" /> : <PlusIcon />}
                {photoBusy ? 'Preparing photo…' : 'Add a photo'}
              </button>
            )}
          </div>
          <p id="f-photo-note" className="note">
            Photos can sometimes show who took them. Only attach if you&rsquo;re comfortable.
          </p>
          {errors.photo && (
            <p className="error" role="alert">
              {errors.photo}
            </p>
          )}
        </div>
      </div>

      <div className="field !mb-0">
        <span aria-hidden="true" />
        <div>
          <button type="submit" className="btn-primary" disabled={sending || photoBusy}>
            <span>{sending ? 'Sending…' : `Send to ${brand.officeNoun}`}</span>
            {sending ? <span className="spinner" aria-hidden="true" /> : <ArrowIcon />}
          </button>
          <p className="mt-4 text-[0.875rem] leading-relaxed text-muted">
            You&rsquo;ll get a tracking code next. It&rsquo;s the only way to check on this later.
          </p>
        </div>
      </div>
    </form>
  );
}

function ArrowIcon() {
  return (
    <svg className="arrow" width="28" height="16" viewBox="0 0 28 16" aria-hidden="true" fill="none">
      <path d="M0 8h25M18 1l7 7-7 7" stroke="currentColor" strokeWidth="2.25" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
      <path d="M9 1v16M1 9h16" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
