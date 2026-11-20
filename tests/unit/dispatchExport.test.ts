import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { brand } from '../../src/brand/brand.config';
import { buildDispatchDocx, buildDispatchXlsx, dispatchFileName } from '../../src/admin/dispatch/print/dispatchExport';
import { toSheetJobs } from '../../src/admin/dispatch/print/sheetModel';

const jobs = [
  {
    id: 'j1', job_number: 'J-2026-0001', title: 'Deliver framed works', job_type: 'delivery', status: 'scheduled',
    start_at: '2026-11-20T16:00:00Z', end_at: '2026-11-20T22:00:00Z', call_time: '2026-11-20T15:00:00Z', call_location: 'Shop',
    team_lead_id: 'c1', crew_notes: 'Shoe covers inside.', office_notes: 'OFFICE-ONLY-MARKER', deleted_at: null,
    stops: [
      { position: 1, kind: 'destination', site_name: 'Residence', address: '45 Sample Rd', contact_name: 'Manager', contact_phone: '+13235550191', window_start: null, window_end: null, access_flags: ['stairs'], access_notes: null },
      { position: 0, kind: 'origin', site_name: 'Warehouse', address: '1200 Example Ave', contact_name: null, contact_phone: null, window_start: null, window_end: null, access_flags: ['loading_dock'], access_notes: null },
    ],
    items: [{ position: 0, description: 'Large framed painting', quantity: 1, height_in: 72, width_in: 96, depth_in: 4, weight_lbs: 140, packing: 'soft_pack', handling_flags: ['glass', 'two_person'] }],
    checklist: [
      { position: 0, label: 'Origin ready', checked_at: '2026-11-19T10:00:00Z' },
      { position: 1, label: 'COI received', checked_at: null },
    ],
  },
  {
    id: 'j2', job_number: 'J-2026-0002', title: 'Cancelled job', job_type: 'pickup', status: 'cancelled',
    start_at: '2026-11-20T17:00:00Z', end_at: '2026-11-20T18:00:00Z', call_time: null, call_location: null,
    team_lead_id: null, crew_notes: null, office_notes: null, deleted_at: null, stops: [], items: [], checklist: [],
  },
];
const src = {
  assignments: [{ job_id: 'j1', crew_member_id: 'c1', role_on_job: null, call_time_override: null }],
  jobAssets: [{ job_id: 'j1', asset_id: 'a1' }],
  crew: [{ id: 'c1', display_name: 'Avery Lane', phone: '+13235550101' }],
  assets: [{ id: 'a1', kind: 'truck', name: 'Truck 26' }],
};
const meta = (includeOfficeNotes: boolean) => ({ label: 'Fri, Nov 20', exportedAt: new Date('2026-11-19T18:00:00Z'), includeOfficeNotes, timeZone: 'America/Los_Angeles' });

describe('sheet model', () => {
  it('skips cancelled jobs, orders stops, names the lead and hides office notes by default', () => {
    const s = toSheetJobs(jobs, src);
    expect(s.map((j) => j.job_number)).toEqual(['J-2026-0001']);
    expect(s[0].stops.map((x) => x.kind)).toEqual(['origin', 'destination']);
    expect(s[0].team_lead?.name).toBe('Avery Lane');
    expect(s[0].crew[0].role_on_job).toBe('Lead');
    expect(s[0].office_notes).toBeNull();
    expect(toSheetJobs(jobs, src, { includeOfficeNotes: true })[0].office_notes).toBe('OFFICE-ONLY-MARKER');
    expect(s[0].checklist).toEqual([{ label: 'Origin ready', checked: true }, { label: 'COI received', checked: false }]);
  });

  it('names files by date or job number', () => {
    expect(dispatchFileName('xlsx', { date: '2026-11-20' })).toBe('dispatch_2026-11-20.xlsx');
    expect(dispatchFileName('docx', { jobNumber: 'J-2026-0001' })).toBe('dispatch_J-2026-0001.docx');
  });
});

describe('dispatch xlsx', () => {
  it('has Jobs, Stops and Items sheets with headers, rows and flag text; no office notes by default', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildDispatchXlsx(toSheetJobs(jobs, src), meta(false))).buffer as ArrayBuffer);
    const ws = wb.getWorksheet('Jobs')!;
    expect(String(ws.getCell('A1').value)).toContain(brand.appName);
    const headers = (ws.getRow(4).values as unknown[]).slice(1);
    expect(headers).toEqual(['Job #', 'Type', 'Title', 'Day', 'Start', 'End', 'Call', 'Team lead', 'Crew', 'Truck / equipment', 'Origin', 'Destination', 'Handling flags', 'Crew notes']);
    expect(ws.getCell('A5').value).toBe('J-2026-0001');
    expect(ws.getCell('G5').value).toBe('7:00 AM at Shop');
    expect(String(ws.getCell('M5').value)).toContain('Two-person minimum');
    expect(ws.getCell('A6').value).toBeNull();
    const items = wb.getWorksheet('Items')!;
    expect(items.getCell('B5').value).toBe('Large framed painting');
    expect(items.getCell('G5').value).toBe(140);
    expect(wb.getWorksheet('Stops')!.getCell('C5').value).toBe('Origin');
    let all = '';
    wb.eachSheet((s) => s.eachRow((r) => (all += JSON.stringify(r.values))));
    expect(all).not.toContain('OFFICE-ONLY-MARKER');
  });

  it('adds an Office notes column only when asked', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildDispatchXlsx(toSheetJobs(jobs, src, { includeOfficeNotes: true }), meta(true))).buffer as ArrayBuffer);
    const ws = wb.getWorksheet('Jobs')!;
    expect(ws.getCell('O4').value).toBe('Office notes');
    expect(ws.getCell('O5').value).toBe('OFFICE-ONLY-MARKER');
  });
});

describe('dispatch docx', () => {
  const text = async (inc: boolean) => {
    const zip = await JSZip.loadAsync(await buildDispatchDocx(toSheetJobs(jobs, src, { includeOfficeNotes: inc }), meta(inc)));
    return (await zip.file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, ' ');
  };
  it('has the title, job details, items with flags and checklist boxes', async () => {
    const t = await text(false);
    expect(t).toContain(`${brand.appName}: Dispatch sheet`);
    expect(t).toContain('J-2026-0001 · Delivery · Deliver framed works');
    expect(t).toContain('Avery Lane');
    expect(t).toContain('Truck 26');
    expect(t).toContain('Glass or glazed');
    expect(t).toContain('72 × 96 × 4 in');
    expect(t).toContain('☑  Origin ready');
    expect(t).toContain('☐  COI received');
    expect(t).not.toContain('OFFICE-ONLY-MARKER');
    expect(t).not.toContain('Cancelled job');
  });
  it('includes office notes only when asked', async () => {
    expect(await text(true)).toContain('OFFICE-ONLY-MARKER');
  });
});
