/**
 * Excel (.xlsx via exceljs) and Word (.docx via docx) exports of the current
 * filtered view, generated entirely in the browser.
 *
 * These builders are pure (rows in → bytes out) so Vitest can open the files
 * and check headers and rows. The console lazy-loads this module on first export.
 *
 * Private admin notes are NOT included: exports are meant to be shareable.
 */
import ExcelJS from 'exceljs';
import {
  AlignmentType,
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
import { brand, displayName } from '../brand/brand.config';
import { CATEGORY_LABEL, STATUS_LABEL, TAG_LABEL, type Category, type Status, type Tag } from '../shared/domain';

export interface ExportRow {
  created_at: string;
  category: Category;
  admin_tag: Tag;
  submitter_tag: Tag;
  status: Status;
  body: string;
  public_reply: string | null;
  published_to_board: boolean;
  board_summary: string | null;
  photo_path: string | null;
}

export interface ExportMeta {
  exportedAt: Date;
  filters: Record<string, string>;
}

export const EXPORT_HEADERS = [
  'Received',
  'Category',
  'Priority',
  'Submitter priority',
  'Status',
  'Suggestion',
  'Public reply',
  'On board',
  'Board summary',
  'Photo',
] as const;

export function exportFileName(ext: 'xlsx' | 'docx', d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `suggestions_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ext}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function filterSummary(filters: Record<string, string>): string {
  const parts = Object.entries(filters).map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join(' · ') : 'none';
}

function rowValues(r: ExportRow): string[] {
  return [
    fmtDate(r.created_at),
    CATEGORY_LABEL[r.category],
    TAG_LABEL[r.admin_tag],
    TAG_LABEL[r.submitter_tag],
    STATUS_LABEL[r.status],
    r.body,
    r.public_reply ?? '',
    r.published_to_board ? 'Yes' : 'No',
    r.board_summary ?? '',
    r.photo_path ? 'Yes' : 'No',
  ];
}

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const bare = (hex: string) => hex.replace('#', '').toUpperCase();

// ── Excel ────────────────────────────────────────────────────────────────────
export async function buildXlsx(rows: ExportRow[], meta: ExportMeta): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = displayName();
  wb.created = meta.exportedAt;
  const ws = wb.addWorksheet('Suggestions', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const widths = [13, 22, 12, 12, 12, 60, 45, 10, 45, 8];
  ws.columns = widths.map((width) => ({ width }));

  ws.mergeCells(1, 1, 1, EXPORT_HEADERS.length);
  const title = ws.getCell(1, 1);
  title.value = `${displayName()}: Suggestions`;
  title.font = { bold: true, size: 16, color: { argb: argb(brand.colors.ink) } };

  ws.mergeCells(2, 1, 2, EXPORT_HEADERS.length);
  ws.getCell(2, 1).value = `Exported ${meta.exportedAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} · ${rows.length} rows`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: argb(brand.colors.muted) } };

  ws.mergeCells(3, 1, 3, EXPORT_HEADERS.length);
  ws.getCell(3, 1).value = `Filters: ${filterSummary(meta.filters)}`;
  ws.getCell(3, 1).font = { size: 10, color: { argb: argb(brand.colors.muted) } };

  const header = ws.getRow(5);
  header.values = [...EXPORT_HEADERS];
  header.height = 22;
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(brand.colors.ink) } };
    c.alignment = { vertical: 'middle' };
  });

  rows.forEach((r, i) => {
    const row = ws.getRow(6 + i);
    row.values = rowValues(r);
    row.alignment = { vertical: 'top', wrapText: true };
    const tagCell = row.getCell(3);
    const colors = brand.tagColors[r.admin_tag];
    tagCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(colors.bg) } };
    tagCell.font = { bold: true, color: { argb: argb(colors.fg) } };
    row.eachCell((c) => {
      c.border = { bottom: { style: 'hair', color: { argb: argb(brand.colors.line) } } };
    });
  });

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + Math.max(rows.length, 1), column: EXPORT_HEADERS.length } };
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

// ── Word ─────────────────────────────────────────────────────────────────────
const DOCX_COLS = ['Received', 'Category', 'Priority', 'Status', 'Suggestion', 'Public reply'] as const;
const DOCX_WIDTHS = [11, 14, 10, 10, 33, 22]; // percent

function cell(text: string, opts: { bold?: boolean; fill?: string; color?: string; width: number }) {
  return new TableCell({
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: bare(opts.fill) } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: text.split('\n').map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, bold: opts.bold, size: 18, color: opts.color ? bare(opts.color) : undefined })],
        }),
    ),
  });
}

export async function buildDocx(rows: ExportRow[], meta: ExportMeta): Promise<Uint8Array> {
  const headerRow = new TableRow({
    tableHeader: true,
    children: DOCX_COLS.map((h, i) =>
      cell(h, { bold: true, fill: brand.colors.ink, color: '#FFFFFF', width: DOCX_WIDTHS[i] }),
    ),
  });
  const bodyRows = rows.map((r) => {
    const tag = brand.tagColors[r.admin_tag];
    const tagText = r.admin_tag === r.submitter_tag ? TAG_LABEL[r.admin_tag] : `${TAG_LABEL[r.admin_tag]}\n(was ${TAG_LABEL[r.submitter_tag]})`;
    return new TableRow({
      cantSplit: false,
      children: [
        cell(fmtDate(r.created_at), { width: DOCX_WIDTHS[0] }),
        cell(CATEGORY_LABEL[r.category], { width: DOCX_WIDTHS[1] }),
        cell(tagText, { bold: true, fill: tag.bg, color: tag.fg, width: DOCX_WIDTHS[2] }),
        cell(STATUS_LABEL[r.status], { width: DOCX_WIDTHS[3] }),
        cell(r.body, { width: DOCX_WIDTHS[4] }),
        cell(r.public_reply ?? '', { width: DOCX_WIDTHS[5] }),
      ],
    });
  });

  const doc = new Document({
    creator: displayName(),
    title: `${displayName()}: Suggestions`,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [
      {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `${displayName()}: Suggestions`, bold: true, size: 36 })] }),
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({
                text: `Exported ${meta.exportedAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} · ${rows.length} rows`,
                size: 18,
                color: bare(brand.colors.muted),
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [new TextRun({ text: `Filters: ${filterSummary(meta.filters)}`, size: 18, color: bare(brand.colors.muted) })],
          }),
          rows.length
            ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] })
            : new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun('No suggestions match these filters.')] }),
        ],
      },
    ],
  });
  const blob = await Packer.toBlob(doc).catch(() => null);
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** Browser-only: save bytes as a file. */
export function download(bytes: Uint8Array, filename: string, mime: string) {
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
