import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { incidentSchema, issues } from '../../../shared/dispatch';
import { crewReportIncident, myJobs, uploadIncidentPhoto, type MyJob } from '../data';
import { Link } from '../../router';
import { ACCEPTED_INPUT, PhotoError, scrubPhoto } from '../../../portal/photo';
import { toLocalInput, ymd } from '../ui';

const MAX_PHOTOS = 4;

/** Named damage / incident report for one of the crew member's own jobs. */
export function CrewIncident({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<MyJob | null | undefined>(undefined);
  const [form, setForm] = useState({
    occurred_at: toLocalInput(new Date().toISOString()),
    job_item_id: '',
    handlers_involved: '',
    description: '',
    supervisor_notified: false,
    supervisor_name: '',
    fragments_retained: false,
    packing_kept: false,
  });
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ photosFailed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const now = new Date();
    myJobs(ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60)), ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30)))
      .then((list) => setJob(list.find((j) => j.id === jobId) ?? null))
      .catch(() => setJob(null));
  }, [jobId]);

  async function addPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const blob = await scrubPhoto(file);
      setPhotos((p) => [...p, { blob, url: URL.createObjectURL(blob) }].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : 'That photo couldn’t be used.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !job) return;
    setError(null);
    const input = { ...form, job_item_id: form.job_item_id || null, occurred_at: form.occurred_at };
    const errs = issues(incidentSchema.safeParse(input));
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const id = await crewReportIncident({
        job_id: job.id,
        job_item_id: input.job_item_id,
        occurred_at: new Date(form.occurred_at).toISOString(),
        handlers_involved: form.handlers_involved,
        description: form.description,
        supervisor_notified: form.supervisor_notified,
        supervisor_name: form.supervisor_notified ? form.supervisor_name : '',
        fragments_retained: form.fragments_retained,
        packing_kept: form.packing_kept,
      });
      let failed = 0;
      for (const p of photos) {
        try {
          await uploadIncidentPhoto(id, p.blob);
        } catch {
          failed++;
        }
      }
      setDone({ photosFailed: failed });
    } catch (x) {
      setError((x as Error).message || 'Couldn’t send the report. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (job === undefined) return <p className="px-4 py-6 text-[1rem]">Loading…</p>;
  if (job === null)
    return (
      <div className="crew-page px-4 py-6">
        <p className="text-[1.0625rem]">This job isn’t on your list.</p>
        <Link href="/admin/my-jobs" className="crew-link">
          ← My jobs
        </Link>
      </div>
    );

  if (done)
    return (
      <div className="crew-page px-4 py-6">
        <h1 className="text-[1.75rem] font-[850] tracking-tight">Report sent</h1>
        <p className="mt-2 text-[1.0625rem]">Thank you. The office has your report and will follow up with you.</p>
        {done.photosFailed > 0 && (
          <p role="alert" className="crew-alert mt-3">
            {done.photosFailed} photo(s) didn’t upload. Tell the office so they can collect them.
          </p>
        )}
        <Link href="/admin/my-jobs" className="crew-incident-btn mt-6">
          Back to My jobs
        </Link>
      </div>
    );

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="crew-page px-4 pb-10">
      <Link href="/admin/my-jobs" className="crew-link mt-3 inline-flex">
        ← My jobs
      </Link>
      <h1 className="mt-2 text-[1.75rem] font-[850] leading-tight tracking-tight">Report damage / incident</h1>
      <p className="text-[1rem] text-muted">
        {job.job_number} · {job.title}
      </p>
      <p className="crew-notice mt-4" role="note">
        <strong>This report is not anonymous.</strong> Your name is attached so the office can follow up.
      </p>

      <form className="mt-5 space-y-5" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="ci-when" className="crew-label">
            When did it happen?
          </label>
          <input id="ci-when" type="datetime-local" className="crew-input" value={form.occurred_at} onChange={(e) => set('occurred_at', e.currentTarget.value)} />
          {errors.occurred_at && <p className="crew-err">{errors.occurred_at}</p>}
        </div>
        <div>
          <label htmlFor="ci-item" className="crew-label">
            Which item? (optional)
          </label>
          <select id="ci-item" className="crew-input" value={form.job_item_id} onChange={(e) => set('job_item_id', e.currentTarget.value)}>
            <option value="">Not item-specific</option>
            {job.items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.description}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ci-handlers" className="crew-label">
            Who was handling it?
          </label>
          <input id="ci-handlers" className="crew-input" value={form.handlers_involved} onChange={(e) => set('handlers_involved', e.currentTarget.value)} />
        </div>
        <div>
          <label htmlFor="ci-desc" className="crew-label">
            What happened?
          </label>
          <textarea id="ci-desc" className="crew-input min-h-[9rem] py-3" value={form.description} onChange={(e) => set('description', e.currentTarget.value)} aria-invalid={errors.description ? true : undefined} />
          {errors.description && <p className="crew-err">{errors.description}</p>}
        </div>

        <fieldset>
          <legend className="crew-label">Was a supervisor told?</legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              [true, 'Yes'],
              [false, 'No'],
            ].map(([v, label]) => (
              <label key={String(v)} className="crew-choice">
                <input type="radio" name="sup" checked={form.supervisor_notified === v} onChange={() => set('supervisor_notified', v as boolean)} />
                <span>{label as string}</span>
              </label>
            ))}
          </div>
          {form.supervisor_notified && (
            <div className="mt-3">
              <label htmlFor="ci-sup" className="crew-label">
                Who?
              </label>
              <input id="ci-sup" className="crew-input" value={form.supervisor_name} onChange={(e) => set('supervisor_name', e.currentTarget.value)} />
            </div>
          )}
        </fieldset>

        <div className="space-y-2">
          <label className="crew-check">
            <input type="checkbox" checked={form.fragments_retained} onChange={(e) => set('fragments_retained', e.currentTarget.checked)} />
            <span>Fragments kept</span>
          </label>
          <label className="crew-check">
            <input type="checkbox" checked={form.packing_kept} onChange={(e) => set('packing_kept', e.currentTarget.checked)} />
            <span>Packing materials kept</span>
          </label>
        </div>

        <div>
          <span className="crew-label" id="ci-photos-l">
            Photos (up to {MAX_PHOTOS})
          </span>
          <input ref={fileRef} type="file" accept={ACCEPTED_INPUT} className="sr-only" aria-labelledby="ci-photos-l" onChange={(e) => addPhoto(e.currentTarget.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={p.url} className="relative">
                <img src={p.url} alt={`Photo ${i + 1}`} className="size-24 border-2 border-ink object-cover" />
                <button type="button" className="crew-photo-x" onClick={() => setPhotos((l) => l.filter((x) => x !== p))} aria-label={`Remove photo ${i + 1}`}>
                  ✕
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button type="button" className="crew-photo-add" onClick={() => fileRef.current?.click()}>
                + Add photo
              </button>
            )}
          </div>
          <p className="mt-1 text-[0.9375rem] text-muted">Location and camera details are removed before upload.</p>
        </div>

        {error && (
          <p role="alert" className="crew-alert">
            {error}
          </p>
        )}
        <button className="crew-incident-btn w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Send report'}
        </button>
      </form>
    </div>
  );
}
