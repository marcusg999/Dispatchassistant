import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { brand } from '../../src/brand/brand.config';
import { EXPORT_HEADERS, buildDocx, buildXlsx, exportFileName, type ExportRow } from '../../src/admin/exporters';

const rows: ExportRow[] = [
  {
    created_at: '2026-11-10T12:00:00Z',
    category: 'safety',
    admin_tag: 'crucial',
    submitter_tag: 'urgent',
    status: 'planned',
    body: 'Strap on the A-frame cart is frayed.',
    public_reply: 'Replacing it this week.',
    published_to_board: true,
    board_summary: 'Cart straps replaced.',
    photo_path: 'x.webp',
  },
  {
    created_at: '2026-11-11T12:00:00Z',
    category: 'other',
    admin_tag: 'important',
    submitter_tag: 'important',
    status: 'new',
    body: 'Break room fridge is broken.',
    public_reply: null,
    published_to_board: false,
    board_summary: null,
    photo_path: null,
  },
];
const meta = { exportedAt: new Date('2026-11-18T15:00:00Z'), filters: { status: 'planned, new', sort: 'newest' } };

describe('exports', () => {
  it('names files suggestions_YYYY-MM-DD', () => {
    expect(exportFileName('xlsx', new Date(2026, 10, 18))).toBe('suggestions_2026-11-18.xlsx');
    expect(exportFileName('docx', new Date(2026, 0, 5))).toBe('suggestions_2026-01-05.docx');
  });

  it('builds an .xlsx with title, filters, headers, rows and a priority-colored tag column', async () => {
    const bytes = await buildXlsx(rows, meta);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const ws = wb.getWorksheet('Suggestions')!;
    expect(String(ws.getCell('A1').value)).toContain(brand.appName);
    expect(String(ws.getCell('A2').value)).toContain('2 rows');
    expect(String(ws.getCell('A3').value)).toContain('status: planned, new');
    expect((ws.getRow(5).values as unknown[]).slice(1)).toEqual([...EXPORT_HEADERS]);
    expect(ws.getCell('B6').value).toBe('Safety');
    expect(ws.getCell('C6').value).toBe('Crucial');
    expect(ws.getCell('D6').value).toBe('Urgent');
    expect(ws.getCell('F6').value).toBe('Strap on the A-frame cart is frayed.');
    expect(ws.getCell('F7').value).toBe('Break room fridge is broken.');
    const fill = ws.getCell('C6').fill as { fgColor?: { argb?: string } };
    expect(fill.fgColor?.argb).toBe(`FF${brand.tagColors.crucial.bg.slice(1).toUpperCase()}`);
    expect(ws.getColumn(6).width).toBeGreaterThanOrEqual(40);
  });

  it('builds a .docx with title, filter summary, header row and every row', async () => {
    const bytes = await buildDocx(rows, meta);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    const text = xml.replace(/<[^>]+>/g, ' ');
    expect(text).toContain(brand.appName);
    expect(text).toContain('status: planned, new');
    for (const h of ['Received', 'Category', 'Priority', 'Status', 'Suggestion', 'Public reply']) expect(text).toContain(h);
    expect(text).toContain('Strap on the A-frame cart is frayed.');
    expect(text).toContain('Break room fridge is broken.');
    expect(text).toContain('(was Urgent)');
    expect(xml).toContain(`w:fill="${brand.tagColors.crucial.bg.slice(1).toUpperCase()}"`);
    expect(xml).toContain('w:orient="landscape"');
  });
});
