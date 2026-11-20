/**
 * Quote PDF generator (pdf-lib, lazy-loaded). Letter size, standard Helvetica only
 * (nothing external is embedded), brand header on every page, wrapped text with
 * automatic page breaks. Pure: QuoteDoc in, bytes out. Runs in the browser on the
 * client quote page and in the admin console.
 */
import { brand, displayName } from '../../brand/brand.config';
import { groupLines, money, dayText, dimsText, qtyText, quoteLabel, stopKindText, type QuoteDoc } from './model';

export interface PdfOptions {
  /** Called for every string drawn: (1-based page number, text). Used by tests. */
  onText?: (page: number, text: string) => void;
}

const PAGE_W = 612;
const PAGE_H = 792;
const M = 56; // side margins
const TOP = PAGE_H - 92; // first content baseline area (below header)
const BOTTOM = 62;
const RIGHT = PAGE_W - M;
const W = RIGHT - M;

/** Helvetica uses WinAnsi: swap or drop anything outside it. */
const EXTRA = new Set('’‘“”–—•…€™'.split(''));
export function winAnsi(s: string): string {
  return s
    .replace(/−/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/\t/g, '    ')
    .replace(/[^\n]/gu, (c) => {
      const code = c.codePointAt(0)!;
      return (code >= 32 && code < 127) || (code >= 160 && code < 256) || EXTRA.has(c) ? c : '?';
    });
}

const hexRgb = (hex: string, rgb: (r: number, g: number, b: number) => unknown) => {
  const h = hex.replace('#', '');
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
};

export async function generateQuotePdf(doc: QuoteDoc, opts: PdfOptions = {}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  type PDFPage = ReturnType<Awaited<ReturnType<typeof PDFDocument.create>>['addPage']>;
  type Color = ReturnType<typeof rgb>;
  const c = (hex: string) => hexRgb(hex, rgb) as Color;
  const ink = c(brand.colors.ink);
  const muted = c(brand.colors.muted);
  const line = c(brand.colors.line);
  const accent = c(brand.colors.accent);
  const wall = c(brand.colors.wall);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${quoteLabel(doc)}: ${doc.title}`);
  pdf.setProducer(displayName());
  pdf.setCreator(displayName());
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = TOP;
  let onNewPage: (() => void) | null = null; // redraws a table header after a break

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = TOP;
    onNewPage?.();
  };
  newPage();

  const draw = (text: string, x: number, size: number, font = reg, color: Color = ink, at = y, pg: PDFPage = page) => {
    const t = winAnsi(text);
    if (!t) return;
    pg.drawText(t, { x, y: at, size, font, color });
    opts.onText?.(pages.indexOf(pg) + 1, t);
  };
  const widthOf = (t: string, size: number, font = reg) => font.widthOfTextAtSize(winAnsi(t), size);
  const drawRight = (text: string, xRight: number, size: number, font = reg, color: Color = ink, at = y) => draw(text, xRight - widthOf(text, size, font), size, font, color, at);

  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };

  /** Break text into lines that fit `width`; long unbroken words are split. */
  const wrap = (text: string, size: number, width: number, font = reg): string[] => {
    const out: string[] = [];
    for (const para of winAnsi(text).split('\n')) {
      if (!para.trim()) {
        out.push('');
        continue;
      }
      let cur = '';
      for (const word of para.split(/ +/)) {
        const trial = cur ? `${cur} ${word}` : word;
        if (font.widthOfTextAtSize(trial, size) <= width) {
          cur = trial;
          continue;
        }
        if (cur) out.push(cur);
        cur = word;
        while (font.widthOfTextAtSize(cur, size) > width) {
          let n = cur.length - 1;
          while (n > 1 && font.widthOfTextAtSize(cur.slice(0, n), size) > width) n--;
          out.push(cur.slice(0, n));
          cur = cur.slice(n);
        }
      }
      out.push(cur);
    }
    return out;
  };

  /** Wrapped paragraph that may flow across pages. */
  const paragraph = (text: string, size: number, opt: { x?: number; width?: number; font?: typeof reg; color?: Color; leading?: number; gap?: number } = {}) => {
    const x = opt.x ?? M;
    const lead = opt.leading ?? size * 1.4;
    for (const ln of wrap(text, size, opt.width ?? W - (x - M), opt.font ?? reg)) {
      ensure(lead);
      y -= size;
      if (ln) draw(ln, x, size, opt.font ?? reg, opt.color ?? ink);
      y -= lead - size;
    }
    y -= opt.gap ?? 0;
  };

  const heading = (text: string) => {
    ensure(60);
    y -= 14;
    draw(text.toUpperCase(), M, 8.5, bold, muted);
    // letter-spaced look without a custom font: a hairline under it
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.6, color: ink });
    y -= 10;
  };

  // ── Title block ──────────────────────────────────────────────────────────
  draw(quoteLabel(doc).toUpperCase(), M, 9, bold, muted, y);
  y -= 10;
  page.drawRectangle({ x: M, y: y - 3, width: 36, height: 3, color: accent });
  y -= 14;
  paragraph(doc.title, 22, { font: bold, leading: 26, gap: 10 });

  const facts: [string, string][] = [
    ['Prepared for', doc.client],
    ['Attention', doc.contact],
    ['Requested date', dayText(doc.requestedDate)],
    ['Valid until', dayText(doc.validUntil)],
  ].filter(([, v]) => v) as [string, string][];
  const colW = W / 2;
  for (let i = 0; i < facts.length; i += 2) {
    ensure(34);
    const rowTop = y;
    let rowMin = y;
    for (const [j, [k, v]] of facts.slice(i, i + 2).entries()) {
      const x = M + j * colW;
      y = rowTop;
      draw(k.toUpperCase(), x, 7.5, bold, muted, y - 8);
      y -= 12;
      for (const ln of wrap(v, 11, colW - 16, bold)) {
        y -= 14;
        draw(ln, x, 11, bold, ink, y + 3);
      }
      rowMin = Math.min(rowMin, y);
    }
    y = rowMin - 8;
  }
  if (doc.status === 'accepted' || doc.accepted) {
    // shown again in the acceptance block; nothing extra here
  }

  // ── Route ────────────────────────────────────────────────────────────────
  if (doc.stops.length) {
    heading('Route');
    doc.stops.forEach((s, i) => {
      const label = `${i + 1}.  ${stopKindText(s.kind)}`;
      const body = [s.site, s.address].filter(Boolean).join(', ');
      const lines = wrap(body, 10, W - 96);
      ensure(lines.length * 14 + 4);
      y -= 12;
      draw(label, M, 10, bold, ink);
      lines.forEach((ln, k) => {
        if (k) y -= 14;
        draw(ln, M + 96, 10);
      });
      y -= 6;
    });
  }

  // ── Items ────────────────────────────────────────────────────────────────
  if (doc.items.length) {
    heading('Items');
    for (const it of doc.items) {
      const head = `${it.description}${it.quantity > 1 ? `  ×${it.quantity}` : ''}`;
      const sub1 = [it.artist, it.medium].filter(Boolean).join(' · ');
      const sub2 = [dimsText(it), it.packing ? `Packing: ${it.packing}` : ''].filter(Boolean).join(' · ');
      const hl = wrap(head, 10.5, W, bold);
      const s1 = sub1 ? wrap(sub1, 9, W, reg) : [];
      const s2 = sub2 ? wrap(sub2, 9, W, reg) : [];
      ensure(hl.length * 14 + (s1.length + s2.length) * 12 + 8);
      for (const ln of hl) {
        y -= 12;
        draw(ln, M, 10.5, bold);
        y -= 2;
      }
      for (const ln of [...s1, ...s2]) {
        y -= 11;
        draw(ln, M, 9, reg, muted);
        y -= 1;
      }
      y -= 8;
    }
  }

  // ── Lines table ──────────────────────────────────────────────────────────
  const xQty = M + 300;
  const xUnit = M + 392;
  const xAmt = RIGHT;
  const descW = 280;
  const tableHead = () => {
    y -= 12;
    draw('DESCRIPTION', M, 7.5, bold, muted);
    drawRight('QTY', xQty + 40, 7.5, bold, muted);
    drawRight('UNIT PRICE', xUnit + 40, 7.5, bold, muted);
    drawRight('AMOUNT', xAmt, 7.5, bold, muted);
    y -= 5;
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.6, color: ink });
    y -= 4;
  };
  if (doc.lines.length) {
    heading('Estimate');
    ensure(80);
    tableHead();
    onNewPage = tableHead;
    for (const g of groupLines(doc.lines)) {
      ensure(40);
      y -= 6;
      page.drawRectangle({ x: M, y: y - 16, width: W, height: 18, color: wall });
      y -= 12;
      draw(g.label, M + 6, 9, bold);
      y -= 8;
      for (const l of g.lines) {
        const dl = wrap(l.description, 9.5, descW);
        ensure(dl.length * 12 + 8);
        y -= 11;
        const top = y;
        dl.forEach((ln, k) => draw(ln, M + 6, 9.5, reg, ink, top - k * 12));
        const showQty = !(l.qty === 1 && (l.unit === 'each' || l.unit === ''));
        if (showQty) {
          drawRight(`${qtyText(l.qty)}${l.unit ? ` ${l.unit}` : ''}`, xQty + 40, 9, reg, muted, top);
          drawRight(money(l.unitPriceCents).replace('−', '-'), xUnit + 40, 9, reg, muted, top);
        }
        drawRight(money(l.amountCents).replace('−', '-'), xAmt, 9.5, bold, ink, top);
        y = top - (dl.length - 1) * 12 - 5;
        page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.3, color: line });
        y -= 2;
      }
    }
    onNewPage = null;

    // Totals
    ensure(110);
    y -= 14;
    const rows: [string, string, boolean][] = [['Subtotal', money(doc.totals.subtotalCents), false]];
    if (doc.totals.discountCents) rows.push(['Discount', money(-Math.abs(doc.totals.discountCents)), false]);
    if (doc.totals.taxCents) rows.push(['Tax', money(doc.totals.taxCents), false]);
    for (const [k, v] of rows) {
      y -= 13;
      draw(k, xUnit - 30, 10, reg, muted);
      drawRight(v.replace('−', '-'), xAmt, 10, reg, ink);
    }
    y -= 8;
    page.drawLine({ start: { x: xUnit - 30, y }, end: { x: RIGHT, y }, thickness: 1, color: ink });
    y -= 18;
    draw('Total', xUnit - 30, 13, bold);
    drawRight(money(doc.totals.totalCents), xAmt, 13, bold);
    y -= 10;
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  if (doc.notes.trim()) {
    heading('Notes');
    paragraph(doc.notes, 10, { gap: 4 });
  }

  // ── Terms ────────────────────────────────────────────────────────────────
  if (doc.terms) {
    heading(`${doc.terms.title} · version ${doc.terms.version}`);
    paragraph(doc.terms.body, 8.5, { leading: 11.5, color: ink, gap: 4 });
  }

  // ── Acceptance ───────────────────────────────────────────────────────────
  ensure(doc.accepted ? 110 : 230); // keep the heading with its block
  heading('Acceptance');
  if (doc.accepted) {
    paragraph(`Accepted by ${doc.accepted.name} on ${new Date(doc.accepted.at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}.`, 11, { font: bold, gap: 4 });
    paragraph(`Total ${money(doc.totals.totalCents)}${doc.terms ? `, ${doc.terms.title} version ${doc.terms.version}` : ''}.`, 10, { color: muted });
  } else {
    paragraph(`By signing, I accept this quote for ${money(doc.totals.totalCents)}${doc.terms ? ` and the ${doc.terms.title} (version ${doc.terms.version})` : ''}.`, 10, { gap: 14 });
    const fields: [string, number, number][] = [
      ['Full name', M, 250],
      ['Title', M + 270, W - 270],
      ['Signature', M, 250],
      ['Date', M + 270, W - 270],
    ];
    for (let i = 0; i < fields.length; i += 2) {
      y -= 30;
      for (const [label, x, w] of fields.slice(i, i + 2)) {
        page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.7, color: ink });
        draw(label, x, 8, reg, muted, y - 11);
      }
      y -= 14;
    }
  }

  // ── Header on EVERY page (needs the final page count) ────────────────────
  pages.forEach((pg, i) => {
    const pageNo = i + 1;
    draw(displayName(), M, 11, bold, ink, PAGE_H - 46, pg);
    const right = `${quoteLabel(doc)} · Page ${pageNo} of ${pages.length}`;
    const t = winAnsi(right);
    draw(t, RIGHT - reg.widthOfTextAtSize(t, 9), 9, reg, muted, PAGE_H - 46, pg);
    pg.drawLine({ start: { x: M, y: PAGE_H - 58 }, end: { x: RIGHT, y: PAGE_H - 58 }, thickness: 1.2, color: ink });
    pg.drawRectangle({ x: M, y: PAGE_H - 60.5, width: 36, height: 3, color: accent });
  });

  return pdf.save();
}
