/** Supabase access for rate cards, rules and terms. RLS lets estimators read and admins write. */
import { ratesSchema, type CrewRule, type PackingRule, type Rates } from '../../../shared/estimate';
import { supabase } from '../../supabase';

export interface RateCardRow {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  effective_from: string | null;
  is_sample: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  rates: Rates;
}

const COLUMNS = 'id, name, status, effective_from, is_sample, reviewed_at, reviewed_by, created_at, rates';

export async function listRateCards(): Promise<RateCardRow[]> {
  const { data, error } = await supabase.from('rate_cards').select(COLUMNS).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RateCardRow[];
}

export async function getRateCard(id: string): Promise<RateCardRow | null> {
  const { data, error } = await supabase.from('rate_cards').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as RateCardRow) ?? null;
}

export async function getActiveRateCard(): Promise<RateCardRow | null> {
  const { data, error } = await supabase.from('rate_cards').select(COLUMNS).eq('status', 'active').maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as RateCardRow) ?? null;
}

/** Copy a card (any status) into a new draft. Returns the new card id. */
export async function duplicateAsDraft(card: Pick<RateCardRow, 'name' | 'rates' | 'is_sample'>): Promise<string> {
  const base = card.name.replace(/\s*\(draft\)$/, '');
  const { data, error } = await supabase
    .from('rate_cards')
    .insert({ name: `${base.slice(0, 91)} (draft)`, status: 'draft', rates: card.rates as never, is_sample: card.is_sample })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function loadRules(): Promise<{ packing: PackingRule[]; crew: CrewRule[] }> {
  const [p, c] = await Promise.all([
    supabase.from('packing_rules').select('*').order('position'),
    supabase.from('crew_size_rules').select('*').order('position'),
  ]);
  if (p.error) throw new Error(p.error.message);
  if (c.error) throw new Error(c.error.message);
  return {
    packing: (p.data ?? []) as unknown as PackingRule[],
    crew: (c.data ?? []).map((r) => ({ ...r, equipment_key: r.equipment_key ?? undefined })) as unknown as CrewRule[],
  };
}

/** Plain-language list of what is wrong with a card, for the save button. */
export function rateProblems(rates: unknown): string[] {
  const r = ratesSchema.safeParse(rates);
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.join(' › ') || 'Rate card'}: ${i.message}`);
}
