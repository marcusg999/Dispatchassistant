/**
 * Dispatch sheet exports: Excel (.xlsx via exceljs) and Word (.docx via docx).
 * Built from SheetJob (same model as the printable sheet). Pure: rows in → bytes out.
 * Office notes appear only if the jobs were built with includeOfficeNotes.
 */
import ExcelJS from 'exceljs';
import {
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { brand, displayName } from '../../../brand/brand.config';
import {
  ACCESS_FLAG_LABEL,
  HANDLING_FLAG,
  JOB_TYPE_LABEL,
  STOP_KIND_LABEL,
  fmtDay,
  fmtTime,
  formatPhone,
  type AccessFlag,
  type HandlingFlag,
} from '../../../shared/dispatch';
import { PACKING_LABEL, type SheetJob } from './sheetModel';

export interface DispatchExportMeta {
  /** e.g. "Thu, Nov 20" or "J-2026-0001". */
  label: string;
  exportedAt: Date;
  includeOfficeNotes: boolean;
  timeZone?: string;
}

export const flagText = (flags: string[]) =>
  flags.map((f) => {
    const h = HANDLING_FLAG[f as HandlingFlag];
    return h ? `${h.glyph} ${h.label}` : f;
  });
export const accessText = (flags: string[]) => flags.map((f) => ACCESS_FLAG_LABEL[f as AccessFlag] ?? f);

export function dispatchFileName(ext: 'xlsx' | 'docx', scope: { date?: string; jobNumber?: string }): string {
  return `dispatch_${scope.jobNumber ?? scope.date ?? 'sheet'}.${ext}`;
}

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const bare = (hex: string) => hex.replace('#', '').toUpperCase();

function callFor(j: SheetJob, tz?: string) {
  const base = j.call_time ? `${fmtTime(j.call_time, tz)}${j.call_location ? ` at ${j.call_location}` : ''}` : '';
  const overrides = j.crew.filter((c) => c.call_time_override).map((c) => `${c.name} ${fmtTime(c.call_time_override, tz)}`);
  return [base, overrides.length ? `(staggered: ${overrides.join(', ')})` : ''].filter(Boolean).join(' ');
}

// ── Excel ────────────────────────────────────────────────────────────────────
export async function buildDispatchXlsx(jobs: SheetJob[], meta: DispatchExportMeta): Promise<Uint8Array> {
  const tz = meta.timeZone;
  const wb = new ExcelJS.Workbook();
  wb.creator = displayName();
  wb.created = meta.exportedAt;

  const sheet = (name: string, headers: string[], widths: number[], rows: (string | number | null)[][]) => {
    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = widths.map((width) => ({ width }));
    ws.mergeCells(1, 1, 1, headers.length);
    ws.getCell(1, 1).value = `${displayName()}: Dispatch sheet · ${meta.label}`;
    ws.getCell(1, 1).font = { bold: true, size: 16, color: { argb: argb(brand.colors.ink) } };
    ws.mergeCells(2, 1, 2, headers.length);
    ws.getCell(2, 1).value = `Exported ${meta.exportedAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} · ${jobs.length} job${jobs.length === 1 ? '' : 's'}${meta.includeOfficeNotes ? ' · includes office notes' : ''}`;
    ws.getCell(2, 1).font = { size: 10, color: { argb: argb(brand.colors.muted) } };
    const header = ws.getRow(4);
    header.values = headers;
    header.height = 22;
    header.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(brand.colors.ink) } };
      c.alignment = { vertical: 'middle' };
    });
    rows.forEach((r, i) => {
      const row = ws.getRow(5 + i);
      row.values = r;
      row.alignment = { vertical: 'top', wrapText: true };
      row.eachCell((c) => {
        c.border = { bottom: { style: 'hair', color: { argb: argb(brand.colors.line) } } };
      });
    });
    return ws;
  };

  const jobHeaders = ['Job #', 'Type', 'Title', 'Day', 'Start', 'End', 'Call', 'Team lead', 'Crew', 'Truck / equipment', 'Origin', 'Destination', 'Handling flags', 'Crew notes'];
  const jobWidths = [13, 12, 30, 12, 9, 9, 22, 18, 30, 20, 30, 30, 30, 34];
  if (meta.includeOfficeNotes) {
    jobHeaders.push('Office notes');
    jobWidths.push(34);
  }
  sheet(
    'Jobs',
    jobHeaders,
    jobWidths,
    jobs.map((j) => {
      const flags = [...new Set(j.items.flatMap((i) => i.handling_flags))];
      const origin = j.stops[0];
      const dest = j.stops.length > 1 ? j.stops[j.stops.length - 1] : undefined;
      const place = (s?: SheetJob['stops'][number]) => (s ? [s.site_name, s.address].filter(Boolean).join(', ') : '');
      const row: (string | number | null)[] = [
        j.job_number,
        JOB_TYPE_LABEL[j.job_type],
        j.title,
        fmtDay(j.start_at, tz),
        fmtTime(j.start_at, tz),
        fmtTime(j.end_at, tz),
        callFor(j, tz),
        j.team_lead ? `${j.team_lead.name} ${formatPhone(j.team_lead.phone)}`.trim() : '',
        j.crew.map((c) => `${c.name}${c.phone ? ` ${formatPhone(c.phone)}` : ''}`).join('\n'),
        j.assets.map((a) => a.name).join(', '),
        place(origin),
        place(dest),
        flagText(flags).join('\n'),
        j.crew_notes ?? '',
      ];
      if (meta.includeOfficeNotes) row.push(j.office_notes ?? '');
      return row;
    }),
  );
  sheet(
    'Stops',
    ['Job #', '#', 'Kind', 'Site', 'Address', 'Window', 'Contact', 'Phone', 'Access', 'Access notes'],
    [13, 5, 12, 22, 36, 16, 20, 16, 30, 34],
    jobs.flatMap((j) =>
      j.stops.map((s, i) => [
        j.job_number,
        i + 1,
        STOP_KIND_LABEL[s.kind],
        s.site_name ?? '',
        s.address,
        s.window_start ? `${fmtTime(s.window_start, tz)}${s.window_end ? `–${fmtTime(s.window_end, tz)}` : ''}` : '',
        s.contact_name ?? '',
        formatPhone(s.contact_phone),
        accessText(s.access_flags).join(', '),
        s.access_notes ?? '',
      ]),
    ),
  );
  sheet(
    'Items',
    ['Job #', 'Description', 'Qty', 'H (in)', 'W (in)', 'D (in)', 'Weight (lb)', 'Packing', 'Handling flags'],
    [13, 40, 6, 8, 8, 8, 11, 11, 40],
    jobs.flatMap((j) =>
      j.items.map((i) => [
        j.job_number,
        i.description,
        i.quantity,
        i.height_in ?? null,
        i.width_in ?? null,
        i.depth_in ?? null,
        i.weight_lbs ?? null,
        i.packing ? (PACKING_LABEL[i.packing] ?? i.packing) : '',
        flagText(i.handling_flags).join('\n'),
      ]),
    ),
  );
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ── Word ─────────────────────────────────────────────────────────────────────
function cell(text: string, opts: { bold?: boolean; header?: boolean; width?: number } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { type: ShadingType.CLEAR, color: 'auto', fill: bare(brand.colors.ink) } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: (text || ' ').split('\n').map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, bold: opts.bold || opts.header, size: 18, color: opts.header ? 'FFFFFF' : undefined })],
        }),
    ),
  });
}
const kv = (k: string, v: string) => new TableRow({ children: [cell(k, { bold: true, width: 22 }), cell(v, { width: 78 })] });

export async function buildDispatchDocx(jobs: SheetJob[], meta: DispatchExportMeta): Promise<Uint8Array> {
  const tz = meta.timeZone;
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `${displayName()}: Dispatch sheet`, bold: true, size: 36 })] }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `${meta.label} · exported ${meta.exportedAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}${meta.includeOfficeNotes ? ' · includes office notes' : ''}`,
          size: 18,
          color: bare(brand.colors.muted),
        }),
      ],
    }),
  ];
  if (!jobs.length) children.push(new Paragraph({ children: [new TextRun('No jobs scheduled.')] }));

  jobs.forEach((j, idx) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: idx > 0,
        children: [new TextRun({ text: `${j.job_number} · ${JOB_TYPE_LABEL[j.job_type]} · ${j.title}`, bold: true, size: 28 })],
      }),
    );
    const rows = [
      kv('When', `${fmtDay(j.start_at, tz)} ${fmtTime(j.start_at, tz)}–${fmtTime(j.end_at, tz)}`),
      kv('Call', callFor(j, tz) || '—'),
      kv('Team lead', j.team_lead ? `${j.team_lead.name} ${formatPhone(j.team_lead.phone)}`.trim() : '—'),
      kv('Crew', j.crew.map((c) => `${c.name}${c.role_on_job ? ` (${c.role_on_job})` : ''}${c.phone ? ` ${formatPhone(c.phone)}` : ''}`).join('\n') || '—'),
      kv('Truck / equipment', j.assets.map((a) => a.name).join(', ') || '—'),
      ...j.stops.map((s, i) =>
        kv(
          `${i + 1}. ${STOP_KIND_LABEL[s.kind]}${s.window_start ? ` ${fmtTime(s.window_start, tz)}${s.window_end ? `–${fmtTime(s.window_end, tz)}` : ''}` : ''}`,
          [
            [s.site_name, s.address].filter(Boolean).join(', '),
            s.contact_name || s.contact_phone ? `Contact: ${[s.contact_name, formatPhone(s.contact_phone)].filter(Boolean).join(' ')}` : '',
            s.access_flags.length ? `Access: ${accessText(s.access_flags).join(', ')}` : '',
            s.access_notes ? `Notes: ${s.access_notes}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ),
      ...(j.crew_notes ? [kv('Crew notes', j.crew_notes)] : []),
      ...(meta.includeOfficeNotes && j.office_notes ? [kv('Office notes', j.office_notes)] : []),
    ];
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    if (j.items.length) {
      children.push(new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text: 'Items', bold: true, size: 22 })] }));
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [cell('Item', { header: true, width: 34 }), cell('Qty', { header: true, width: 6 }), cell('Size / weight', { header: true, width: 20 }), cell('Packing', { header: true, width: 10 }), cell('Handling', { header: true, width: 30 })],
            }),
            ...j.items.map(
              (i) =>
                new TableRow({
                  children: [
                    cell(i.description),
                    cell(String(i.quantity)),
                    cell(
                      [
                        [i.height_in, i.width_in, i.depth_in].every((d) => d != null) ? `${i.height_in} × ${i.width_in} × ${i.depth_in} in` : '',
                        i.weight_lbs != null ? `${i.weight_lbs} lb` : '',
                      ]
                        .filter(Boolean)
                        .join('\n'),
                    ),
                    cell(i.packing ? (PACKING_LABEL[i.packing] ?? i.packing) : ''),
                    cell(flagText(i.handling_flags).join('\n'), { bold: i.handling_flags.length > 0 }),
                  ],
                }),
            ),
          ],
        }),
      );
    }
    if (j.checklist.length) {
      children.push(new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text: 'Checklist', bold: true, size: 22 })] }));
      for (const c of j.checklist) children.push(new Paragraph({ children: [new TextRun({ text: `${c.checked ? '☑' : '☐'}  ${c.label}`, size: 20 })] }));
    }
  });

  const doc = new Document({
    creator: displayName(),
    title: `${displayName()}: Dispatch sheet`,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [
      {
        properties: { page: { size: { orientation: PageOrientation.PORTRAIT }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(doc).catch(() => null);
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await Packer.toBuffer(doc));
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
