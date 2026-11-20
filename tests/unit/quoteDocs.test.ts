import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { displayName } from '../../src/brand/brand.config';
import { SAMPLE_CREW_RULES, SAMPLE_PACKING_RULES, SAMPLE_RATES, clientView, computeEstimate, type EstimateInput } from '../../src/shared/estimate';
import { fromQuoteApi, quoteFileBase, quoteLabel, type QuoteDoc } from '../../src/shared/quote/model';
import { generateQuotePdf, winAnsi } from '../../src/shared/quote/pdf';
import { buildInternalXlsx, buildQuoteDocx, buildQuoteXlsx, type InternalSheet } from '../../src/admin/estimates/exports/quoteFiles';
import { cushionSpec, stencilLines } from '../../src/admin/estimates/pages/BuildSheet';

const mediums = ['Oil on canvas', 'Graphite on paper, framed', 'Bronze sculpture', 'Glazed ceramic', 'Acrylic on canvas', 'Marble'];
const items: EstimateInput['items'] = Array.from({ length: 14 }, (_, i) => ({
  id: `i${i}`,
  description: `Work number ${i + 1} with a deliberately long description so that wrapping is exercised across the column`,
  medium: mediums[i % mediums.length],
  height_in: 20 + i * 4,
  width_in: 16 + i * 3,
  depth_in: 2 + (i % 5),
  weight_lbs: 12 + i * 9,
  quantity: 1 + (i % 3),
  declared_value_cents: 500_000 + i * 100_000,
  handling_flags: i % 2 ? ['glass', 'no_stack'] : ['upright'],
  packing_method: i % 3 === 0 ? 'custom_crate' : null,
}));
const input: EstimateInput = {
  options: { service_type: 'delivery', vehicle_key: 'truck_air_ride', vehicle_hours: 9, labor_hours: 9, discount_bp: 500, access: { stairs_flight: 2 }, addons: { placement: 1 } },
  stops: [{}, { miles_from_previous: 120 }, { miles_from_previous: 35 }],
  items,
};
const result = computeEstimate(input, { rates: SAMPLE_RATES, packing_rules: SAMPLE_PACKING_RULES, crew_rules: SAMPLE_CREW_RULES });
const cv = clientView(result);

const TERMS = Array.from({ length: 40 }, (_, i) => `${i + 1}. Term paragraph ${i + 1}: the client agrees that handling, transport and installation are provided on the conditions set out here, including access, timing, declared values and insurance, and that changes to scope may change the price.`).join('\n\n');

function makeDoc(over: Partial<QuoteDoc> = {}): QuoteDoc {
  return {
    ...fromQuoteApi({
      estimate_number: 'Q-2026-0042',
      revision: 2,
      title: 'Spring gallery delivery',
      client_name: 'Sample Gallery',
      contact_name: 'Registrar',
      requested_date: '2026-12-01',
      valid_until: '2026-12-31',
      status: 'sent',
      notes_client: 'Please confirm dock hours. Smart “quotes” and – dashes ≥ survive.',
      stops: [
        { kind: 'pickup', site_name: 'Warehouse', address: '1200 Example Ave' },
        { kind: 'dropoff', site_name: 'Gallery', address: '45 Sample Rd' },
      ],
      items: items.map((i) => ({ description: i.description, medium: i.medium, height_in: i.height_in, width_in: i.width_in, depth_in: i.depth_in, quantity: i.quantity, packing: 'Custom crate' })),
      lines: cv.lines,
      totals: cv.totals,
      terms: { id: '11111111-1111-1111-1111-111111111111', version: 3, title: 'Quote terms', body: TERMS },
      accepted: null,
    }),
    ...over,
  };
}

describe('quote PDF', () => {
  it('spans pages, draws the brand header on every page, and loads', async () => {
    const doc = makeDoc();
    const drawn: Record<number, string[]> = {};
    const bytes = await generateQuotePdf(doc, { onText: (p, t) => (drawn[p] ??= []).push(t) });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    for (let p = 1; p <= pdf.getPageCount(); p++) {
      expect(drawn[p], `page ${p}`).toContain(displayName());
      expect(drawn[p].some((t) => t.startsWith(`${quoteLabel(doc)} · Page ${p} of ${pdf.getPageCount()}`))).toBe(true);
    }
    const all = Object.values(drawn).flat().join('\n');
    expect(all).toContain('Spring gallery delivery');
    expect(all).toContain('VALID UNTIL');
    expect(all).toContain('Total');
    expect(all).toContain('Discount');
    expect(all).toMatch(/-\$[\d,]+\.\d\d/); // discount shown with a minus sign
    expect(all).toContain('ACCEPTANCE');
    expect(all).toContain('Signature');
    expect(all).toContain('Term paragraph 40');
  });

  it('shows the recorded acceptance instead of blank signature lines', async () => {
    const texts: string[] = [];
    await generateQuotePdf(makeDoc({ accepted: { name: 'Jordan Reyes', at: '2026-11-20T18:30:00Z' } }), { onText: (_, t) => texts.push(t) });
    expect(texts.join('\n')).toContain('Accepted by Jordan Reyes');
    expect(texts.join('\n')).not.toContain('Signature');
  });

  it('only emits WinAnsi-safe text (no throw on odd characters)', async () => {
    expect(winAnsi('a−b ≥ ✓ “q”')).toBe('a-b ? ? “q”');
    await expect(generateQuotePdf(makeDoc({ title: 'Emoji 🎨 and ≥ title' }))).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('quote Word and Excel', () => {
  const doc = makeDoc();
  const lineDesc = doc.lines.find((l) => l.category === 'transport')!.description;

  it('docx has the title, a line description, the total and a header on every page', async () => {
    const bytes = await buildQuoteDocx(doc);
    const zip = await JSZip.loadAsync(bytes);
    const body = await zip.file('word/document.xml')!.async('string');
    expect(body).toContain('Spring gallery delivery');
    expect(body).toContain(lineDesc);
    expect(body).toContain('Quote terms (version 3)');
    expect(body).toContain((doc.totals.totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
    const header = await zip.file('word/header1.xml')!.async('string');
    expect(header).toContain(displayName());
    expect(header).toContain('Quote Q-2026-0042, revision 2');
  });

  it('client xlsx has headers, rows and a total, and no cost or margin', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildQuoteXlsx(doc)) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Quote')!;
    expect(String(ws.getCell(1, 1).value)).toContain(displayName());
    expect(ws.getRow(5).values).toEqual([undefined, 'Category', 'Description', 'Qty', 'Unit', 'Unit price', 'Amount']);
    expect(ws.getCell(6, 2).value).toBeTruthy();
    const rows: unknown[][] = [];
    ws.eachRow((r) => rows.push(r.values as unknown[]));
    const totalRow = rows.find((r) => r[5] === 'Total')!;
    expect(totalRow[6]).toBeCloseTo(doc.totals.totalCents / 100, 2);
    const discount = rows.find((r) => r[5] === 'Discount')!;
    expect(discount[6] as number).toBeLessThan(0);
    const text = JSON.stringify(rows).toLowerCase();
    expect(text).not.toContain('margin');
    expect(text).not.toContain('unit cost');
    expect(wb.getWorksheet('Items')!.rowCount).toBe(doc.items.length + 1);
  });

  it('internal xlsx adds cost and margin per line plus totals', async () => {
    const internal: InternalSheet = {
      lines: result.lines.map((l) => ({ category: l.category, description: l.description, qty: l.qty, unit: l.unit, unitPriceCents: l.unit_price_cents, unitCostCents: l.unit_cost_cents, amountCents: l.amount_cents, costCents: l.cost_cents, clientVisible: l.client_visible })),
      totalCents: result.totals.total_cents,
      costCents: result.totals.cost_cents,
      marginCents: result.totals.margin_cents,
      marginBp: result.totals.margin_bp,
      notesInternal: 'Internal only',
    };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildInternalXlsx(doc, internal)) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Cost & margin')!;
    expect((ws.getRow(5).values as unknown[]).slice(1)).toEqual(['Category', 'Description', 'Qty', 'Unit', 'Unit price', 'Unit cost', 'Amount', 'Cost', 'Margin', 'Margin %', 'On quote']);
    const first = ws.getRow(6);
    expect(first.getCell(8).value).toBe(internal.lines[0].costCents / 100);
    expect(first.getCell(9).value).toBeCloseTo((internal.lines[0].amountCents - internal.lines[0].costCents) / 100, 2);
    const rows: unknown[][] = [];
    ws.eachRow((r) => rows.push(r.values as unknown[]));
    expect(rows.find((r) => r[8] === 'Total cost')![9]).toBe(internal.costCents / 100);
    expect(rows.find((r) => r[8] === 'Margin %')![9]).toBeCloseTo(internal.marginBp / 10_000, 4);
    expect(String(ws.getCell(2, 1).value)).toContain('INTERNAL');
  });

  it('names files like quote_Q-2026-0042_r2', () => {
    expect(quoteFileBase(doc)).toBe('quote_Q-2026-0042_r2');
  });
});

describe('build sheet helpers', () => {
  it('stencils follow the handling flags', () => {
    expect(stencilLines(['upright'])).toEqual(['THIS SIDE UP']);
    expect(stencilLines(['top_heavy', 'glass', 'no_stack', 'keep_flat'])).toEqual(['THIS SIDE UP', 'FRAGILE', 'DO NOT STACK', 'KEEP FLAT']);
    expect(stencilLines(['two_person'])).toEqual([]);
  });
  it('cushioning follows the medium and method', () => {
    expect(cushionSpec({ method: 'standard_crate', medium: 'Graphite on paper' }, 2).join(' ')).toMatch(/glassine/i);
    expect(cushionSpec({ method: 'standard_crate', medium: 'Oil on canvas' }, 2).join(' ')).toMatch(/corner blocks/i);
    expect(cushionSpec({ method: 'standard_crate', medium: 'Bronze' }, 2).join(' ')).toMatch(/blocking and bracing/i);
    expect(cushionSpec({ method: 'standard_crate', medium: 'Glazed ceramic' }, 2).join(' ')).toMatch(/double box/i);
  });
});
