/**
 * One shared quote document model. Built from the public API JSON (client page)
 * or from database rows (admin exports) so a single generator serves both.
 * Only client-visible lines ever enter this model: no costs, margins or traces.
 */
import { LINE_CATEGORIES, LINE_CATEGORY_LABEL, PACKING_LABEL, formatCents, type LineCategory, type PackingMethod } from '../estimate';

export interface QuoteStop {
  kind: string;
  site: string;
  address: string;
}
export interface QuoteItem {
  description: string;
  artist: string;
  medium: string;
  height: number | null;
  width: number | null;
  depth: number | null;
  quantity: number;
  packing: string;
}
export interface QuoteLine {
  category: LineCategory;
  description: string;
  qty: number;
  unit: string;
  unitPriceCents: number;
  amountCents: number;
}
export interface QuoteTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}
export interface QuoteTerms {
  id: string;
  version: number;
  title: string;
  body: string;
}
export interface QuoteDoc {
  number: string;
  revision: number;
  title: string;
  client: string;
  contact: string;
  requestedDate: string | null;
  validUntil: string | null;
  status: string;
  stops: QuoteStop[];
  items: QuoteItem[];
  lines: QuoteLine[];
  totals: QuoteTotals;
  notes: string;
  terms: QuoteTerms | null;
  accepted: { name: string; at: string } | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const cat = (v: unknown): LineCategory => ((LINE_CATEGORIES as readonly string[]).includes(str(v)) ? (v as LineCategory) : 'other');

export const STOP_KIND_TEXT: Record<string, string> = { origin: 'Pickup', destination: 'Delivery', stop: 'Stop' };
export const stopKindText = (k: string) => STOP_KIND_TEXT[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Stop');

/** API JSON of GET /api/quote/:token (the `quote` object). */
export function fromQuoteApi(q: Record<string, any>): QuoteDoc { // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = q.totals ?? {};
  return {
    number: str(q.estimate_number),
    revision: Number(q.revision ?? 1),
    title: str(q.title),
    client: str(q.client_name),
    contact: str(q.contact_name),
    requestedDate: q.requested_date ?? null,
    validUntil: q.valid_until ?? null,
    status: str(q.status),
    stops: ((q.stops as any[]) ?? []).map((s) => ({ kind: str(s.kind), site: str(s.site_name), address: str(s.address) })), // eslint-disable-line @typescript-eslint/no-explicit-any
    items: ((q.items as any[]) ?? []).map((i) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      description: str(i.description),
      artist: str(i.artist_title),
      medium: str(i.medium),
      height: num(i.height_in),
      width: num(i.width_in),
      depth: num(i.depth_in),
      quantity: Number(i.quantity ?? 1),
      packing: str(i.packing),
    })),
    lines: ((q.lines as any[]) ?? []).map((l) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      category: cat(l.category),
      description: str(l.description),
      qty: Number(l.qty ?? 0),
      unit: str(l.unit),
      unitPriceCents: Number(l.unit_price_cents ?? 0),
      amountCents: Number(l.amount_cents ?? 0),
    })),
    totals: {
      subtotalCents: Number(t.subtotal_cents ?? 0),
      discountCents: Number(t.discount_cents ?? 0),
      taxCents: Number(t.tax_cents ?? 0),
      totalCents: Number(t.total_cents ?? 0),
    },
    notes: str(q.notes_client),
    terms: q.terms ? { id: str(q.terms.id), version: Number(q.terms.version), title: str(q.terms.title), body: str(q.terms.body) } : null,
    accepted: q.accepted ? { name: str(q.accepted.name), at: str(q.accepted.at) } : null,
  };
}

/** Database rows (admin). Non client-visible lines are dropped here. */
export interface EstimateRows {
  estimate: {
    estimate_number: string;
    revision: number;
    title: string;
    status?: string;
    requested_date: string | null;
    valid_until: string | null;
    notes_client: string | null;
    subtotal_cents: number | string;
    discount_cents: number | string;
    tax_cents: number | string;
    total_cents: number | string;
  };
  stops: { kind: string; site_name: string | null; address: string }[];
  items: {
    id?: string;
    description: string;
    artist_title: string | null;
    medium: string | null;
    height_in: number | string | null;
    width_in: number | string | null;
    depth_in: number | string | null;
    quantity: number;
    packing_method: string | null;
    packing_suggested?: string | null;
  }[];
  lines: { category: string; description: string; qty: number | string; unit: string; unit_price_cents: number | string; amount_cents: number | string; client_visible: boolean }[];
  clientName: string | null;
  contactName?: string | null;
  terms: { id: string; version: number; title: string; body: string } | null;
  accepted?: { name: string; at: string } | null;
}

export function fromEstimate(r: EstimateRows): QuoteDoc {
  const e = r.estimate;
  const packLabel = (m: string | null | undefined) => (m ? (PACKING_LABEL[m as PackingMethod] ?? m) : '');
  return {
    number: e.estimate_number,
    revision: e.revision,
    title: e.title,
    client: r.clientName ?? '',
    contact: r.contactName ?? '',
    requestedDate: e.requested_date,
    validUntil: e.valid_until,
    status: e.status ?? 'draft',
    stops: r.stops.map((s) => ({ kind: s.kind, site: s.site_name ?? '', address: s.address })),
    items: r.items.map((i) => ({
      description: i.description,
      artist: i.artist_title ?? '',
      medium: i.medium ?? '',
      height: num(i.height_in),
      width: num(i.width_in),
      depth: num(i.depth_in),
      quantity: i.quantity,
      packing: packLabel(i.packing_method ?? i.packing_suggested),
    })),
    lines: r.lines
      .filter((l) => l.client_visible)
      .map((l) => ({ category: cat(l.category), description: l.description, qty: Number(l.qty), unit: l.unit, unitPriceCents: Number(l.unit_price_cents), amountCents: Number(l.amount_cents) })),
    totals: { subtotalCents: Number(e.subtotal_cents), discountCents: Number(e.discount_cents), taxCents: Number(e.tax_cents), totalCents: Number(e.total_cents) },
    notes: e.notes_client ?? '',
    terms: r.terms,
    accepted: r.accepted ?? null,
  };
}

// ── shared formatting ───────────────────────────────────────────────────────

export const money = (cents: number) => formatCents(cents);

/** Lines grouped by category in the engine's category order; discount and tax are shown in totals, so they are kept as their own groups last. */
export function groupLines(lines: QuoteLine[]): { category: LineCategory; label: string; lines: QuoteLine[] }[] {
  return LINE_CATEGORIES.map((c) => ({ category: c, label: LINE_CATEGORY_LABEL[c], lines: lines.filter((l) => l.category === c) })).filter((g) => g.lines.length);
}

export const dimsText = (i: Pick<QuoteItem, 'height' | 'width' | 'depth'>) =>
  [i.height, i.width, i.depth].every((d) => d != null) ? `${i.height} × ${i.width} × ${i.depth} in (H × W × D)` : '';

export const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/** yyyy-mm-dd → "Nov 20, 2026" (no time zone shifting). */
export function dayText(ymd: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export const quoteLabel = (d: Pick<QuoteDoc, 'number' | 'revision'>) => `Quote ${d.number}, revision ${d.revision}`;
export const quoteFileBase = (d: Pick<QuoteDoc, 'number' | 'revision'>) => `quote_${d.number}_r${d.revision}`;
