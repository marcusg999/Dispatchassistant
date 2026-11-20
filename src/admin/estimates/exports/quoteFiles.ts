/**
 * Quote Word and Excel files, and the INTERNAL Excel sheet (cost and margin).
 * Pure: QuoteDoc (client-visible lines only) in, bytes out. Same patterns as the dispatch exports.
 */
import ExcelJS from 'exceljs';
import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, TabStopType, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { brand, displayName } from '../../../brand/brand.config';
import { LINE_CATEGORY_LABEL, type LineCategory } from '../../../shared/estimate';
import { dayText, dimsText, groupLines, money, qtyText, quoteLabel, stopKindText, type QuoteDoc } from '../../../shared/quote/model';

export interface InternalLine {
  category: string;
  description: string;
  qty: number;
  unit: string;
  unitPriceCents: number;
  unitCostCents: number;
  amountCents: number;
  costCents: number;
  clientVisible: boolean;
}
export interface InternalSheet {
  lines: InternalLine[];
  totalCents: number;
  costCents: number;
  marginCents: number;
  marginBp: number;
  notesInternal: string;
}

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const bare = (hex: string) => hex.replace('#', '').toUpperCase();
const USD = '"$"#,##0.00;-"$"#,##0.00';
const dollars = (cents: number) => cents / 100;
const catLabel = (c: string) => LINE_CATEGORY_LABEL[c as LineCategory] ?? c;

// ── Excel (client) ───────────────────────────────────────────────────────────
function titleRows(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, cols: number, subtitle: string, title: string) {
  void wb;
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = `${displayName()}: ${title}`;
  ws.getCell(1, 1).font = { bold: true, size: 16, color: { argb: argb(brand.colors.ink) } };
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = { size: 10, color: { argb: argb(brand.colors.muted) } };
}
function headerRow(ws: ExcelJS.Worksheet, rowNo: number, headers: string[], rightFrom: number[] = []) {
  const header = ws.getRow(rowNo);
  header.values = headers;
  header.height = 22;
  header.eachCell((c, n) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(brand.colors.ink) } };
    c.alignment = { vertical: 'middle', horizontal: rightFrom.includes(n) ? 'right' : 'left' };
  });
}
const hair = (row: ExcelJS.Row) =>
  row.eachCell((c) => {
    c.border = { bottom: { style: 'hair', color: { argb: argb(brand.colors.line) } } };
  });

export async function buildQuoteXlsx(doc: QuoteDoc): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = displayName();
  wb.created = new Date();
  const ws = wb.addWorksheet('Quote', { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 22 }, { width: 52 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 14 }];
  titleRows(wb, ws, 6, [quoteLabel(doc), doc.title, doc.client && `Prepared for ${doc.client}`, doc.validUntil && `Valid until ${dayText(doc.validUntil)}`].filter(Boolean).join(' · '), quoteLabel(doc));
  headerRow(ws, 5, ['Category', 'Description', 'Qty', 'Unit', 'Unit price', 'Amount'], [3, 5, 6]);
  let r = 6;
  for (const g of groupLines(doc.lines)) {
    for (const l of g.lines) {
      const row = ws.getRow(r++);
      row.values = [g.label, l.description, l.qty, l.unit, dollars(l.unitPriceCents), dollars(l.amountCents)];
      row.alignment = { vertical: 'top', wrapText: true };
      row.getCell(5).numFmt = USD;
      row.getCell(6).numFmt = USD;
      row.getCell(3).alignment = { horizontal: 'right', vertical: 'top' };
      hair(row);
    }
  }
  r++;
  const total = (label: string, cents: number, bold = false) => {
    const row = ws.getRow(r++);
    row.getCell(5).value = label;
    row.getCell(6).value = dollars(cents);
    row.getCell(6).numFmt = USD;
    row.getCell(5).alignment = { horizontal: 'right' };
    row.font = { bold };
  };
  total('Subtotal', doc.totals.subtotalCents);
  if (doc.totals.discountCents) total('Discount', -Math.abs(doc.totals.discountCents));
  if (doc.totals.taxCents) total('Tax', doc.totals.taxCents);
  total('Total', doc.totals.totalCents, true);
  if (doc.notes.trim()) {
    r++;
    ws.getCell(r, 1).value = 'Notes';
    ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(r, 2, r, 6);
    ws.getCell(r, 2).value = doc.notes;
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
  }

  const items = wb.addWorksheet('Items');
  items.columns = [{ width: 40 }, { width: 6 }, { width: 28 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 24 }];
  headerRow(items, 1, ['Description', 'Qty', 'Artist / medium', 'H (in)', 'W (in)', 'D (in)', 'Packing'], [2, 4, 5, 6]);
  doc.items.forEach((i, n) => {
    const row = items.getRow(2 + n);
    row.values = [i.description, i.quantity, [i.artist, i.medium].filter(Boolean).join(' · '), i.height, i.width, i.depth, i.packing];
    row.alignment = { vertical: 'top', wrapText: true };
    hair(row);
  });
  const stops = wb.addWorksheet('Route');
  stops.columns = [{ width: 5 }, { width: 14 }, { width: 30 }, { width: 50 }];
  headerRow(stops, 1, ['#', 'Kind', 'Site', 'Address']);
  doc.stops.forEach((s, n) => {
    const row = stops.getRow(2 + n);
    row.values = [n + 1, stopKindText(s.kind), s.site, s.address];
    hair(row);
  });
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ── Excel (INTERNAL: cost and margin) ────────────────────────────────────────
export async function buildInternalXlsx(doc: QuoteDoc, internal: InternalSheet): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = displayName();
  wb.created = new Date();
  const ws = wb.addWorksheet('Cost & margin', { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 20 }, { width: 44 }, { width: 8 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 10 }, { width: 10 }];
  titleRows(wb, ws, 11, `INTERNAL: not for clients · ${quoteLabel(doc)} · ${doc.title}${doc.client ? ` · ${doc.client}` : ''}`, `${quoteLabel(doc)}, internal cost & margin`);
  ws.getCell(2, 1).font = { size: 10, bold: true, color: { argb: argb(brand.colors.danger) } };
  headerRow(ws, 5, ['Category', 'Description', 'Qty', 'Unit', 'Unit price', 'Unit cost', 'Amount', 'Cost', 'Margin', 'Margin %', 'On quote'], [3, 5, 6, 7, 8, 9, 10]);
  let r = 6;
  for (const l of internal.lines) {
    const margin = l.amountCents - l.costCents;
    const row = ws.getRow(r++);
    row.values = [catLabel(l.category), l.description, l.qty, l.unit, dollars(l.unitPriceCents), dollars(l.unitCostCents), dollars(l.amountCents), dollars(l.costCents), dollars(margin), l.amountCents > 0 ? margin / l.amountCents : null, l.clientVisible ? 'Yes' : 'No'];
    row.alignment = { vertical: 'top', wrapText: true };
    for (const n of [5, 6, 7, 8, 9]) row.getCell(n).numFmt = USD;
    row.getCell(10).numFmt = '0.0%';
    hair(row);
  }
  r++;
  const totals: [string, number, string?][] = [
    ['Total price', internal.totalCents],
    ['Total cost', internal.costCents],
    ['Margin', internal.marginCents],
  ];
  for (const [label, cents] of totals) {
    const row = ws.getRow(r++);
    row.getCell(8).value = label;
    row.getCell(8).alignment = { horizontal: 'right' };
    row.getCell(9).value = dollars(cents);
    row.getCell(9).numFmt = USD;
    row.font = { bold: true };
  }
  const mrow = ws.getRow(r++);
  mrow.getCell(8).value = 'Margin %';
  mrow.getCell(8).alignment = { horizontal: 'right' };
  mrow.getCell(9).value = internal.marginBp / 10_000;
  mrow.getCell(9).numFmt = '0.0%';
  mrow.font = { bold: true };
  if (internal.notesInternal.trim()) {
    r++;
    ws.getCell(r, 1).value = 'Internal notes';
    ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(r, 2, r, 11);
    ws.getCell(r, 2).value = internal.notesInternal;
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ── Word ─────────────────────────────────────────────────────────────────────
type Align = (typeof AlignmentType)[keyof typeof AlignmentType];
function cell(text: string, o: { bold?: boolean; header?: boolean; width?: number; right?: boolean; shade?: string; span?: number; color?: string } = {}) {
  const align: Align = o.right ? AlignmentType.RIGHT : AlignmentType.LEFT;
  return new TableCell({
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    columnSpan: o.span,
    shading: o.header ? { type: ShadingType.CLEAR, color: 'auto', fill: bare(brand.colors.ink) } : o.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: o.shade } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: (text || ' ').split('\n').map((line) => new Paragraph({ alignment: align, children: [new TextRun({ text: line, bold: o.bold || o.header, size: 18, color: o.header ? 'FFFFFF' : o.color })] })),
  });
}
const h2 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 80 }, children: [new TextRun({ text, bold: true, size: 22 })] });
const para = (text: string, size = 20, color?: string) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, size, color })] });

export async function buildQuoteDocx(doc: QuoteDoc): Promise<Uint8Array> {
  const muted = bare(brand.colors.muted);
  const children: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: quoteLabel(doc).toUpperCase(), size: 18, bold: true, color: muted })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 160 }, children: [new TextRun({ text: doc.title, bold: true, size: 44 })] }),
  ];
  const facts: [string, string][] = ([['Prepared for', doc.client], ['Attention', doc.contact], ['Requested date', dayText(doc.requestedDate)], ['Valid until', dayText(doc.validUntil)]] as [string, string][]).filter(([, v]) => v);
  if (facts.length)
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: facts.map(([k, v]) => new TableRow({ children: [cell(k, { bold: true, width: 24 }), cell(v, { width: 76 })] })) }));

  if (doc.stops.length) {
    children.push(h2('Route'));
    doc.stops.forEach((s, i) => children.push(para(`${i + 1}. ${stopKindText(s.kind)}: ${[s.site, s.address].filter(Boolean).join(', ')}`)));
  }
  if (doc.items.length) {
    children.push(h2('Items'));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: [cell('Item', { header: true, width: 40 }), cell('Qty', { header: true, width: 8 }), cell('Size', { header: true, width: 27 }), cell('Packing', { header: true, width: 25 })] }),
          ...doc.items.map((i) => new TableRow({ cantSplit: true, children: [cell([i.description, [i.artist, i.medium].filter(Boolean).join(' · ')].filter(Boolean).join('\n')), cell(String(i.quantity)), cell(dimsText(i)), cell(i.packing)] })),
        ],
      }),
    );
  }
  children.push(h2('Estimate'));
  const rows: TableRow[] = [
    new TableRow({ tableHeader: true, children: [cell('Description', { header: true, width: 46 }), cell('Qty', { header: true, width: 14, right: true }), cell('Unit price', { header: true, width: 20, right: true }), cell('Amount', { header: true, width: 20, right: true })] }),
  ];
  for (const g of groupLines(doc.lines)) {
    rows.push(new TableRow({ cantSplit: true, children: [cell(g.label, { bold: true, span: 4, shade: bare(brand.colors.wall) })] }));
    for (const l of g.lines) {
      const single = l.qty === 1 && (l.unit === 'each' || l.unit === '');
      rows.push(new TableRow({ cantSplit: true, children: [cell(l.description), cell(single ? '' : `${qtyText(l.qty)} ${l.unit}`.trim(), { right: true }), cell(single ? '' : money(l.unitPriceCents), { right: true }), cell(money(l.amountCents), { right: true, bold: true })] }));
    }
  }
  const tot = (label: string, cents: number, bold = false) => new TableRow({ children: [cell('', { span: 2 }), cell(label, { right: true, bold }), cell(money(cents), { right: true, bold })] });
  rows.push(tot('Subtotal', doc.totals.subtotalCents));
  if (doc.totals.discountCents) rows.push(tot('Discount', -Math.abs(doc.totals.discountCents)));
  if (doc.totals.taxCents) rows.push(tot('Tax', doc.totals.taxCents));
  rows.push(tot('Total', doc.totals.totalCents, true));
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));

  if (doc.notes.trim()) {
    children.push(h2('Notes'));
    for (const p of doc.notes.split('\n')) children.push(para(p));
  }
  if (doc.terms) {
    children.push(h2(`${doc.terms.title} (version ${doc.terms.version})`));
    for (const p of doc.terms.body.split('\n')) children.push(para(p, 17));
  }
  children.push(h2('Acceptance'));
  if (doc.accepted) {
    children.push(para(`Accepted by ${doc.accepted.name} on ${new Date(doc.accepted.at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}.`, 22));
  } else {
    children.push(para(`By signing, I accept this quote for ${money(doc.totals.totalCents)}${doc.terms ? ` and the ${doc.terms.title} (version ${doc.terms.version})` : ''}.`));
    for (const f of ['Full name', 'Title', 'Signature', 'Date']) children.push(new Paragraph({ spacing: { before: 360 }, children: [new TextRun({ text: `${f}: ______________________________________________`, size: 20 })] }));
  }

  const file = new Document({
    creator: displayName(),
    title: `${quoteLabel(doc)}: ${doc.title}`,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 900, left: 1000, right: 1000 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: bare(brand.colors.ink), space: 4 } },
                children: [new TextRun({ text: displayName(), bold: true, size: 22 }), new TextRun({ text: `\t${quoteLabel(doc)} · Page `, size: 18, color: muted }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: muted }), new TextRun({ text: ' of ', size: 18, color: muted }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: muted })],
                tabStops: [{ type: TabStopType.RIGHT, position: 9900 }],
              }),
            ],
          }),
        },
        footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: displayName(), size: 16, color: muted })] })] }) },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(file).catch(() => null);
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await Packer.toBuffer(file));
}

