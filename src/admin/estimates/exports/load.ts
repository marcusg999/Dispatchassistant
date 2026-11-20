import { supabase } from '../../supabase';
import { fromEstimate, type QuoteDoc } from '../../../shared/quote/model';
import type { InternalSheet } from './quoteFiles';

/** Everything an export needs, loaded with the signed-in staff member's own session (RLS applies). */
export async function loadExportData(estimateId: string): Promise<{ doc: QuoteDoc; internal: InternalSheet }> {
  const { data: est, error } = await supabase.from('estimates').select('*, clients(name)').eq('id', estimateId).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!est) throw new Error('Estimate not found.');
  const [stops, items, lines, terms, contact, acc] = await Promise.all([
    supabase.from('estimate_stops').select('*').eq('estimate_id', estimateId).order('position'),
    supabase.from('estimate_items').select('*').eq('estimate_id', estimateId).order('position'),
    supabase.from('estimate_lines').select('*').eq('estimate_id', estimateId).order('sort'),
    est.terms_version_id ? supabase.from('terms_versions').select('id, version, title, body').eq('id', est.terms_version_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    est.contact_id ? supabase.from('client_contacts').select('name').eq('id', est.contact_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('quote_acceptances').select('accepted_name, accepted_at').eq('estimate_id', estimateId).maybeSingle(),
  ]);
  for (const r of [stops, items, lines]) if (r.error) throw new Error(r.error.message);
  const clients = est.clients as { name: string } | { name: string }[] | null;
  const lineRows = lines.data ?? [];
  const doc = fromEstimate({
    estimate: est,
    stops: stops.data ?? [],
    items: items.data ?? [],
    lines: lineRows,
    clientName: (Array.isArray(clients) ? clients[0]?.name : clients?.name) ?? null,
    contactName: contact.data?.name ?? null,
    terms: terms.data ?? null,
    accepted: acc.data ? { name: acc.data.accepted_name, at: acc.data.accepted_at } : null,
  });
  const internal: InternalSheet = {
    lines: lineRows.map((l) => ({
      category: l.category,
      description: l.description,
      qty: Number(l.qty),
      unit: l.unit,
      unitPriceCents: Number(l.unit_price_cents),
      unitCostCents: Number(l.unit_cost_cents),
      amountCents: Number(l.amount_cents),
      costCents: Number(l.cost_cents),
      clientVisible: l.client_visible,
    })),
    totalCents: Number(est.total_cents),
    costCents: Number(est.cost_cents),
    marginCents: Number(est.margin_cents),
    marginBp: Number(est.margin_bp),
    notesInternal: est.notes_internal ?? '',
  };
  return { doc, internal };
}
