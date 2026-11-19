import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { CREW_POSITIONS, CREW_POSITION_LABEL, crewMemberSchema, formatPhone, issues, toE164, type CrewPosition } from '../../../shared/dispatch';
import { addCert, deleteCert, listCertTypes, listCrew, listSkills, saveCrew, setCrewActive, type CertType, type Skill } from '../data';
import { Link, navigate } from '../../router';
import { ErrorNote } from '../../components/ui';
import { CERT_STATE_LABEL, certState, fmtYmd } from '../people/certs';

type Crew = Awaited<ReturnType<typeof listCrew>>[number];

export function CrewDetail({ id, canEdit }: { id: string | null; canEdit: boolean }) {
  const [crew, setCrew] = useState<Crew | null | undefined>(id ? undefined : null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [certTypes, setCertTypes] = useState<CertType[]>([]);
  const [form, setForm] = useState({
    display_name: '',
    phone: '',
    email: '',
    position: 'art_handler' as CrewPosition,
    lift: '',
    sms_opt_in: false,
    sms_opt_in_method: '',
    office_notes: '',
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [certType, setCertType] = useState('');
  const [certExp, setCertExp] = useState('');

  async function reload() {
    const [all, s, ct] = await Promise.all([listCrew(), listSkills(), listCertTypes()]);
    setSkills(s);
    setCertTypes(ct);
    if (!certType && ct[0]) setCertType(ct[0].slug);
    if (id) {
      const c = all.find((x) => x.id === id) ?? null;
      setCrew(c);
      if (c)
        setForm({
          display_name: c.display_name,
          phone: formatPhone(c.phone),
          email: c.email ?? '',
          position: c.position as CrewPosition,
          lift: c.lift_capacity_lbs?.toString() ?? '',
          sms_opt_in: c.sms_opt_in,
          sms_opt_in_method: c.sms_opt_in_method ?? '',
          office_notes: c.office_notes ?? '',
        });
      if (c) setPicked(c.skills);
    }
  }
  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    const phone = form.phone.trim() ? toE164(form.phone) : null;
    if (form.phone.trim() && !phone) return setErrors({ phone: 'Use a full phone number, e.g. (323) 555-1234 or +1 323 555 1234.' });
    const input = {
      display_name: form.display_name,
      phone,
      email: form.email.trim() ? form.email : null,
      position: form.position,
      lift_capacity_lbs: form.lift.trim() ? Number(form.lift) : null,
      sms_opt_in: form.sms_opt_in,
      sms_opt_in_method: form.sms_opt_in_method.trim() || null,
      office_notes: form.office_notes.trim() || null,
    };
    const r = crewMemberSchema.safeParse(input);
    const errs = issues(r);
    if (form.sms_opt_in && !phone) errs.sms_opt_in = 'SMS consent needs a phone number.';
    setErrors(errs);
    if (Object.keys(errs).length || !r.success) return;
    try {
      const row = await saveCrew(id, { ...r.data, email: r.data.email ?? null, phone: r.data.phone ?? null, lift_capacity_lbs: r.data.lift_capacity_lbs ?? null, sms_opt_in_method: r.data.sms_opt_in_method ?? null, office_notes: r.data.office_notes ?? null }, picked);
      if (!id) navigate(`/admin/dispatch/crew/${row.id}`);
      else {
        setSaved(true);
        await reload();
      }
    } catch (x) {
      setError((x as Error).message);
    }
  }

  if (crew === undefined) return <p className="text-muted">Loading…</p>;
  if (id && crew === null) return <p>Crew member not found.</p>;
  const ro = !canEdit;

  return (
    <div className="max-w-4xl">
      <Link href="/admin/dispatch/crew" className="text-[0.8125rem] font-semibold text-muted">
        ← Crew
      </Link>
      <h1 className="mt-2 text-2xl font-[800] tracking-tight">{id ? crew?.display_name : 'Add crew member'}</h1>
      {crew && !crew.active && (
        <p className="mt-2 border-l-4 border-danger pl-3 font-semibold" role="status">
          Inactive: hidden from the roster and can’t be assigned.
        </p>
      )}

      <form className="a-panel mt-4 grid gap-4 p-5 md:grid-cols-2" onSubmit={onSubmit} noValidate>
        <Field label="Name" id="c-name" error={errors.display_name}>
          <input id="c-name" className="a-input" value={form.display_name} disabled={ro} onChange={(e) => set('display_name', e.currentTarget.value)} />
        </Field>
        <Field label="Position" id="c-pos">
          <select id="c-pos" className="a-select" value={form.position} disabled={ro} onChange={(e) => set('position', e.currentTarget.value)}>
            {CREW_POSITIONS.map((p) => (
              <option key={p} value={p}>
                {CREW_POSITION_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Phone" id="c-phone" error={errors.phone} hint="Saved in international format (+1…) for future text dispatch.">
          <input id="c-phone" type="tel" className="a-input" autoComplete="off" value={form.phone} disabled={ro} onChange={(e) => set('phone', e.currentTarget.value)} />
        </Field>
        <Field label="Email (optional)" id="c-email" error={errors.email} hint="Links to sign-in when this email also has the crew role (Staff roles).">
          <input id="c-email" type="email" className="a-input" value={form.email} disabled={ro} onChange={(e) => set('email', e.currentTarget.value)} />
        </Field>
        <Field label="Lift capacity (lb)" id="c-lift" error={errors.lift_capacity_lbs}>
          <input id="c-lift" inputMode="numeric" className="a-input" value={form.lift} disabled={ro} onChange={(e) => set('lift', e.currentTarget.value)} />
        </Field>
        <fieldset className="md:col-span-2">
          <legend className="a-label">Skills</legend>
          <div className="flex flex-wrap gap-2">
            {skills.map((s) => (
              <label key={s.slug} className="flex min-h-[44px] items-center gap-2 border border-line px-3">
                <input
                  type="checkbox"
                  className="size-4"
                  disabled={ro}
                  checked={picked.includes(s.slug)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setPicked((p) => (on ? [...p, s.slug] : p.filter((x) => x !== s.slug)));
                  }}
                />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="md:col-span-2 border-t border-line pt-4">
          <label className="flex min-h-[44px] items-center gap-2 font-semibold">
            <input type="checkbox" className="size-4" disabled={ro} checked={form.sms_opt_in} onChange={(e) => set('sms_opt_in', e.currentTarget.checked)} />
            Agreed to receive dispatch texts
          </label>
          {errors.sms_opt_in && <p className="text-danger">{errors.sms_opt_in}</p>}
          {crew?.sms_opt_in_at && <p className="text-[0.8125rem] text-muted">Consent recorded {new Date(crew.sms_opt_in_at).toLocaleString()}</p>}
          <Field label="How consent was given" id="c-method" hint="Record how consent was given (e.g. signed form, verbal on 2026-11-20). No texts are sent yet.">
            <input id="c-method" className="a-input" value={form.sms_opt_in_method} disabled={ro} onChange={(e) => set('sms_opt_in_method', e.currentTarget.value)} />
          </Field>
        </div>
        <Field label="Office notes (office only)" id="c-notes" className="md:col-span-2" hint="Never shown to crew.">
          <textarea id="c-notes" className="a-textarea" value={form.office_notes} disabled={ro} onChange={(e) => set('office_notes', e.currentTarget.value)} />
        </Field>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <button className="a-btn a-btn-primary">{id ? 'Save changes' : 'Add crew member'}</button>
            {saved && (
              <span role="status" className="font-semibold text-accent-text">
                Saved.
              </span>
            )}
          </div>
        )}
        <div className="md:col-span-2">
          <ErrorNote error={error} />
        </div>
      </form>

      {crew && (
        <section className="a-panel mt-6 p-5" aria-labelledby="certs-h">
          <h2 id="certs-h" className="text-base font-bold">
            Certifications
          </h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {crew.certs.length === 0 && <li className="py-2 text-muted">None recorded.</li>}
            {crew.certs.map((c) => {
              const st = certState(c.expires_on);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-semibold">{certTypes.find((t) => t.slug === c.type)?.label ?? c.type}</span>
                  <span className="text-muted">{c.expires_on ? `Expires ${fmtYmd(c.expires_on)}` : 'No expiry'}</span>
                  {(st === 'expired' || st === 'soon') && (
                    <span className={`cert-badge cert-${st}`}>
                      <span aria-hidden="true">{st === 'expired' ? '✕' : '!'}</span> {CERT_STATE_LABEL[st]}
                    </span>
                  )}
                  {canEdit && (
                    <button className="a-btn a-btn-sm ml-auto" onClick={async () => (await deleteCert(c.id), reload())}>
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {canEdit && (
            <form
              className="mt-3 flex flex-wrap items-end gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await addCert(crew.id, certType, certExp || null);
                  setCertExp('');
                  await reload();
                } catch (x) {
                  setError((x as Error).message);
                }
              }}
            >
              <div>
                <label htmlFor="cert-type" className="a-label">
                  Type
                </label>
                <select id="cert-type" className="a-select" value={certType} onChange={(e) => setCertType(e.currentTarget.value)}>
                  {certTypes.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cert-exp" className="a-label">
                  Expires (optional)
                </label>
                <input id="cert-exp" type="date" className="a-input" value={certExp} onChange={(e) => setCertExp(e.currentTarget.value)} />
              </div>
              <button className="a-btn">Add certification</button>
            </form>
          )}
        </section>
      )}

      {crew && canEdit && (
        <section className="a-panel mt-6 p-5" aria-labelledby="deact-h">
          <h2 id="deact-h" className="text-base font-bold">
            {crew.active ? 'Deactivate' : 'Reactivate'}
          </h2>
          <p className="mt-1 text-muted">
            Crew members are never deleted, so past jobs keep their history. Deactivating hides them from the roster.
          </p>
          <button
            className="a-btn mt-3"
            onClick={async () => {
              await setCrewActive(crew.id, !crew.active);
              await reload();
            }}
          >
            {crew.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  id,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="a-label">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[0.8125rem] text-muted">{hint}</p>}
      {error && (
        <p className="mt-1 font-semibold text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
