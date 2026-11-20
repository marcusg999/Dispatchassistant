import { useState } from 'react';
import { supabase } from '../../supabase';
import { quoteFileBase } from '../../../shared/quote/model';
import { ErrorNote } from '../../components/ui';
import { DOCX_MIME, PDF_MIME, XLSX_MIME, downloadBytes } from './download';

type Format = 'pdf' | 'docx' | 'xlsx' | 'xlsx_internal';

/**
 * Export buttons for one estimate: client Quote PDF / Word / Excel (client-visible lines only)
 * and the INTERNAL Excel with cost and margin. Generated in the browser; each export is audited
 * through log_estimate_export. Everything heavy (pdf-lib, docx, exceljs) loads on click.
 * `isAdmin` is accepted for the builder's convenience; admins and estimators both see all four.
 */
export function EstimateExports({ estimateId }: { estimateId: string; isAdmin?: boolean }) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(format: Format) {
    setBusy(format);
    setError(null);
    setDone(null);
    try {
      const [{ loadExportData }, files] = await Promise.all([import('./load'), import('./quoteFiles')]);
      const { doc, internal } = await loadExportData(estimateId);
      const base = quoteFileBase(doc);
      let bytes: Uint8Array;
      let name: string;
      let mime: string;
      if (format === 'pdf') {
        const { generateQuotePdf } = await import('../../../shared/quote/pdf');
        bytes = await generateQuotePdf(doc);
        name = `${base}.pdf`;
        mime = PDF_MIME;
      } else if (format === 'docx') {
        bytes = await files.buildQuoteDocx(doc);
        name = `${base}.docx`;
        mime = DOCX_MIME;
      } else if (format === 'xlsx') {
        bytes = await files.buildQuoteXlsx(doc);
        name = `${base}.xlsx`;
        mime = XLSX_MIME;
      } else {
        bytes = await files.buildInternalXlsx(doc, internal);
        name = `${base}_internal.xlsx`;
        mime = XLSX_MIME;
      }
      downloadBytes(bytes, name, mime);
      const { error: logErr } = await supabase.rpc('log_estimate_export', { p_estimate: estimateId, p_format: format, p_internal: format === 'xlsx_internal' });
      if (logErr) setError(`Downloaded ${name}, but the export couldn’t be logged: ${logErr.message}`);
      else setDone(`Downloaded ${name}`);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const btn = (format: Format, label: string, primary = false) => (
    <button type="button" className={`a-btn ${primary ? 'a-btn-primary' : ''}`} onClick={() => void run(format)} disabled={!!busy}>
      {busy === format ? 'Preparing…' : label}
    </button>
  );

  return (
    <section aria-label="Exports" className="a-panel p-4">
      <h2 className="text-[1rem] font-[800]">Exports</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {btn('pdf', 'Quote PDF', true)}
        {btn('docx', 'Word (.docx)')}
        {btn('xlsx', 'Excel (.xlsx)')}
        {btn('xlsx_internal', 'Internal Excel (cost & margin)')}
      </div>
      <p className="mt-2 text-[0.8125rem] text-muted">Client files include only what the client sees. The internal Excel has costs and margin: never send it to a client.</p>
      <p role="status" className="mt-1 text-[0.875rem]">
        {done}
      </p>
      <ErrorNote error={error} />
    </section>
  );
}
