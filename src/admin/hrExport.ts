/** Excel export of HR reports (lazy-loaded; HR members only, since RLS supplies the rows). */
import ExcelJS from 'exceljs';
import { brand, displayName } from '../brand/brand.config';
import { STATUS_LABEL } from '../shared/domain';
import type { HrReport } from './hrData';

export const HR_EXPORT_HEADERS = ['Received', 'Name', 'Contact', 'Status', 'Report', 'Reply'] as const;

export function hrExportFileName(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `hr_reports_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
}

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;

export async function buildHrXlsx(rows: HrReport[], exportedAt = new Date()): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = displayName();
  const ws = wb.addWorksheet('HR reports', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = [14, 24, 26, 12, 60, 45].map((width) => ({ width }));

  ws.mergeCells(1, 1, 1, HR_EXPORT_HEADERS.length);
  ws.getCell(1, 1).value = `${displayName()}: HR reports`;
  ws.getCell(1, 1).font = { bold: true, size: 16 };
  ws.mergeCells(2, 1, 2, HR_EXPORT_HEADERS.length);
  ws.getCell(2, 1).value =
    `Exported ${exportedAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} · ${rows.length} rows · CONFIDENTIAL: HR eyes only`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: argb(brand.colors.muted) } };

  const header = ws.getRow(4);
  header.values = [...HR_EXPORT_HEADERS];
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(brand.colors.ink) } };
  });
  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.values = [
      new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }),
      r.full_name,
      r.contact ?? '',
      STATUS_LABEL[r.status],
      r.body,
      r.public_reply ?? '',
    ];
    row.alignment = { vertical: 'top', wrapText: true };
  });
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
