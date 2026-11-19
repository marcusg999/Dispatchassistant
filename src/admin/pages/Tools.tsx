import { useMemo, useState } from 'react';
import { brand, displayName } from '../../brand/brand.config';
import { FLYER_COPY, isPortalLink, qrPath } from '../../shared/flyer';
import { fullBackup, logExport } from '../data';
import { ErrorNote } from '../components/ui';

export function Tools() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const valid = isPortalLink(link);

  async function backup() {
    setBusy(true);
    setError(null);
    try {
      const data = await fullBackup();
      const payload = {
        app: displayName(),
        exported_at: new Date().toISOString(),
        note: 'Non-deleted suggestions and their private notes. Photos are not included (they stay in private storage).',
        ...data,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await logExport('backup_json', {}, data.suggestions.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="no-print a-panel max-w-3xl p-5" aria-labelledby="backup-h">
        <h1 id="backup-h" className="text-xl font-[800] tracking-tight">
          Download full backup
        </h1>
        <p className="mt-1 text-muted">
          A JSON file with every suggestion that isn’t deleted, plus private notes. Store it somewhere safe: it contains
          everything people wrote. Downloads are recorded in the audit log.
        </p>
        <button className="a-btn a-btn-primary mt-4" onClick={backup} disabled={busy}>
          {busy ? 'Preparing…' : 'Download backup (.json)'}
        </button>
        <ErrorNote error={error} />
      </section>

      <section className="no-print a-panel max-w-3xl p-5" aria-labelledby="flyer-h">
        <h2 id="flyer-h" className="text-xl font-[800] tracking-tight">
          Printable flyer
        </h2>
        <p className="mt-1 text-muted">
          Paste the portal link (the one with <code>/s/</code> in it). The link isn’t saved anywhere. Print, or choose
          “Save as PDF” in the print dialog. If you rotate the portal key, print a new flyer.
        </p>
        <label htmlFor="portal-link" className="a-label mt-4">
          Portal link
        </label>
        <input
          id="portal-link"
          className="a-input"
          value={link}
          onChange={(e) => setLink(e.currentTarget.value)}
          placeholder="https://your-site.netlify.app/s/…"
          autoComplete="off"
          spellCheck={false}
        />
        {link && !valid && <p className="mt-2 text-danger">That doesn’t look like a portal link.</p>}
        <button className="a-btn a-btn-primary mt-4" disabled={!valid} onClick={() => window.print()}>
          Print flyer
        </button>
      </section>

      {valid && <Flyer link={link.trim()} />}
    </div>
  );
}

/** One US-Letter/A4 page. Print CSS hides everything else. */
export function Flyer({ link }: { link: string }) {
  const qr = useMemo(() => qrPath(link), [link]);
  return (
    <article
      aria-label="Flyer preview"
      className="flyer mx-auto flex aspect-[8.5/11] w-full max-w-[680px] flex-col border border-ink bg-paper p-[6%] print:max-w-none print:border-0"
    >
      <div className="flex items-center justify-between">
        <span className="stencil text-[0.8rem]">{displayName()}</span>
        <span className="stencil text-[0.7rem] text-muted">No. 01</span>
      </div>
      <p className="stencil mt-[8%] text-[0.9rem] text-accent-text">{FLYER_COPY.eyebrow}</p>
      <h2 className="mt-2 text-[clamp(3rem,10vw,5.5rem)] font-[820] leading-[0.88] tracking-[-0.035em]">{FLYER_COPY.headline}</h2>
      <ul className="mt-6 space-y-1.5 text-[1.15rem] leading-snug">
        {FLYER_COPY.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="mt-auto flex items-end gap-6">
        <div className="w-[42%] border-2 border-ink bg-white p-3">
          <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} role="img" aria-label="QR code to the suggestion box" className="block h-auto w-full">
            <rect x="-2" y="-2" width={qr.size + 4} height={qr.size + 4} fill="#fff" />
            <path d={qr.d} fill={brand.colors.ink} shapeRendering="crispEdges" />
          </svg>
        </div>
        <div className="flex-1 pb-1">
          <div className="mb-3 h-3 w-24 bg-accent" aria-hidden="true" />
          <p className="text-[1rem] font-bold leading-snug">{FLYER_COPY.footer}</p>
          <p className="mt-2 break-all text-[0.7rem] text-muted">{link}</p>
        </div>
      </div>
    </article>
  );
}
