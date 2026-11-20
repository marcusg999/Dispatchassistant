import { useEffect, useMemo, useState } from 'react';
import { CREW_POSITION_LABEL, formatPhone, type CrewPosition } from '../../../shared/dispatch';
import { listCertTypes, listCrew, listSkills, type CertType, type Skill } from '../data';
import { Link, navigate } from '../../router';
import { ErrorNote } from '../../components/ui';
import { CERT_STATE_LABEL, certState } from '../people/certs';

type Crew = Awaited<ReturnType<typeof listCrew>>[number];

export function CrewList({ canEdit }: { canEdit: boolean }) {
  const [crew, setCrew] = useState<Crew[] | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [certTypes, setCertTypes] = useState<CertType[]>([]);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listCrew(), listSkills(), listCertTypes()])
      .then(([c, s, ct]) => {
        setCrew(c);
        setSkills(s);
        setCertTypes(ct);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const skillLabel = (slug: string) => skills.find((s) => s.slug === slug)?.label ?? slug;
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (crew ?? []).filter(
      (c) =>
        (showInactive || c.active) &&
        (!term || c.display_name.toLowerCase().includes(term) || c.skills.some((s) => skillLabel(s).toLowerCase().includes(term))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew, q, showInactive, skills]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-[800] tracking-tight">Crew</h1>
          <p className="text-muted">{crew ? `${rows.length} shown` : 'Loading…'}</p>
        </div>
        <div>
          <label htmlFor="crew-q" className="a-label">
            Search name or skill
          </label>
          <input id="crew-q" type="search" className="a-input !w-64" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        </div>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="checkbox" className="size-4" checked={showInactive} onChange={(e) => setShowInactive(e.currentTarget.checked)} />
          Show inactive
        </label>
        {canEdit && (
          <Link href="/admin/dispatch/crew/new" className="a-btn a-btn-primary no-underline">
            Add crew member
          </Link>
        )}
      </div>
      <ErrorNote error={error} />

      <div className="a-panel mt-4 overflow-x-auto">
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Position</th>
              <th scope="col">Skills</th>
              <th scope="col">Phone</th>
              <th scope="col">Certifications</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const warnings = c.certs
                .map((cert) => ({ cert, state: certState(cert.expires_on) }))
                .filter((x) => x.state === 'expired' || x.state === 'soon');
              return (
                <tr key={c.id} onClick={() => navigate(`/admin/dispatch/crew/${c.id}`)}>
                  <td className="font-semibold">
                    <Link href={`/admin/dispatch/crew/${c.id}`} className="text-ink no-underline hover:underline">
                      {c.display_name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{CREW_POSITION_LABEL[c.position as CrewPosition]}</td>
                  <td>
                    <ul className="flex flex-wrap gap-1">
                      {c.skills.map((s) => (
                        <li key={s} className="skill-chip">
                          {skillLabel(s)}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="whitespace-nowrap">{formatPhone(c.phone)}</td>
                  <td>
                    {warnings.length === 0 ? (
                      <span className="text-muted">{c.certs.length ? 'All valid' : '·'}</span>
                    ) : (
                      <ul className="flex flex-wrap gap-1">
                        {warnings.map(({ cert, state }) => (
                          <li key={cert.id} className={`cert-badge cert-${state}`}>
                            <span aria-hidden="true">{state === 'expired' ? '✕' : '!'}</span> {CERT_STATE_LABEL[state]}: {certTypes.find((t) => t.slug === cert.type)?.label ?? cert.type}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{c.active ? 'Active' : <span className="text-muted">Inactive</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {crew && rows.length === 0 && <p className="p-4 text-muted">No crew members match.</p>}
      </div>
    </div>
  );
}
