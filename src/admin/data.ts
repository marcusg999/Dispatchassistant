/**
 * Thin, typed data-access layer for the admin console. Every call runs as the
 * signed-in admin under RLS; filtering, search, sorting and paging happen in Postgres.
 */
import type { Category, Status, Tag } from '../shared/domain';
import type { Database } from '../shared/database.types';
import { supabase } from './supabase';

export type Suggestion = Database['public']['Tables']['suggestions']['Row'];
export type Note = Database['public']['Tables']['admin_notes']['Row'];
export type Admin = Database['public']['Tables']['admins']['Row'];
export type AuditRow = Database['public']['Tables']['audit_log']['Row'];

/** Columns the console needs. `search` (tsvector) and `tracking_hash` are never fetched. */
export const SUGGESTION_COLUMNS =
  'id, created_at, updated_at, body, category, submitter_tag, admin_tag, status, public_reply, published_to_board, board_summary, photo_path, deleted_at' as const;
export type SuggestionView = Omit<Suggestion, 'search' | 'tracking_hash'>;

export type SortKey = 'newest' | 'oldest' | 'priority';

export interface Filters {
  q: string;
  tags: Tag[];
  categories: Category[];
  statuses: Status[];
  hasPhoto: boolean;
  from: string; // yyyy-mm-dd or ''
  to: string;
  sort: SortKey;
  trash: boolean;
}

export const EMPTY_FILTERS: Filters = {
  q: '',
  tags: [],
  categories: [],
  statuses: [],
  hasPhoto: false,
  from: '',
  to: '',
  sort: 'newest',
  trash: false,
};

export const PAGE_SIZE = 25;

class DataError extends Error {}
/** Throws on error; otherwise returns data. (`null` from maybeSingle() is handled by callers.) */
function check<T>(r: { data: T | null; error: { message: string; hint?: string | null } | null }): T {
  if (r.error) throw new DataError(r.error.hint === 'last_admin' ? 'You can’t remove the last admin.' : r.error.message);
  return r.data as T;
}

/** Converts a yyyy-mm-dd local date into an inclusive ISO range bound. */
function dayBound(d: string, end: boolean): string {
  const [y, m, day] = d.split('-').map(Number);
  const dt = end ? new Date(y, m - 1, day + 1) : new Date(y, m - 1, day);
  return dt.toISOString();
}

function applyFilters<Q extends { [k: string]: any }>(query: Q, f: Filters): Q {
  let q: any = query;
  q = f.trash ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  if (f.tags.length) q = q.in('admin_tag', f.tags);
  if (f.categories.length) q = q.in('category', f.categories);
  if (f.statuses.length) q = q.in('status', f.statuses);
  if (f.hasPhoto) q = q.not('photo_path', 'is', null);
  if (f.from) q = q.gte('created_at', dayBound(f.from, false));
  if (f.to) q = q.lt('created_at', dayBound(f.to, true));
  if (f.q.trim()) q = q.textSearch('search', f.q.trim(), { type: 'websearch', config: 'english' });
  if (f.sort === 'priority') q = q.order('admin_tag', { ascending: false }).order('created_at', { ascending: false });
  else q = q.order('created_at', { ascending: f.sort === 'oldest' });
  return q;
}

export async function listSuggestions(f: Filters, page: number) {
  const fromIdx = page * PAGE_SIZE;
  const r = await applyFilters(
    supabase.from('suggestions').select(SUGGESTION_COLUMNS, { count: 'exact' }),
    f,
  ).range(fromIdx, fromIdx + PAGE_SIZE - 1);
  const rows = check(r) as SuggestionView[];
  return { rows, count: r.count ?? 0 };
}

/** Every row matching the filters (paged through in chunks), for exports. */
export async function allMatching(f: Filters): Promise<SuggestionView[]> {
  const out: SuggestionView[] = [];
  for (let i = 0; ; i += 1000) {
    const r = await applyFilters(supabase.from('suggestions').select(SUGGESTION_COLUMNS), f).range(i, i + 999);
    const rows = check(r) as SuggestionView[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function getSuggestion(id: string): Promise<SuggestionView | null> {
  return check(await supabase.from('suggestions').select(SUGGESTION_COLUMNS).eq('id', id).maybeSingle()) as SuggestionView | null;
}

export type SuggestionPatch = Partial<
  Pick<Suggestion, 'admin_tag' | 'status' | 'public_reply' | 'published_to_board' | 'board_summary' | 'deleted_at'>
>;

export async function updateSuggestion(id: string, patch: SuggestionPatch): Promise<SuggestionView> {
  return check(
    await supabase.from('suggestions').update(patch).eq('id', id).select(SUGGESTION_COLUMNS).single(),
  ) as SuggestionView;
}

export const softDelete = (id: string) => updateSuggestion(id, { deleted_at: new Date().toISOString() });
export const restore = (id: string) => updateSuggestion(id, { deleted_at: null });

/** Removes the photo from Storage first, then the row (notes cascade). Both steps are audited. */
export async function hardDelete(s: Pick<Suggestion, 'id' | 'photo_path'>): Promise<void> {
  if (s.photo_path) {
    const { error } = await supabase.storage.from('suggestion-photos').remove([s.photo_path]);
    if (error) throw new DataError(`Couldn’t remove the photo: ${error.message}`);
  }
  check(await supabase.rpc('hard_delete_suggestion', { p_id: s.id }));
}

/** Short-lived (5 minute) signed URL for a private photo. */
export async function photoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('suggestion-photos').createSignedUrl(path, 300);
  if (error || !data) throw new DataError('Couldn’t load the photo.');
  return data.signedUrl;
}

export async function listNotes(suggestionId: string): Promise<Note[]> {
  return check(
    await supabase.from('admin_notes').select('*').eq('suggestion_id', suggestionId).order('created_at', { ascending: true }),
  );
}

export async function addNote(suggestionId: string, body: string): Promise<Note> {
  // author_email is set by a database trigger from the signed-in session; it can't be spoofed.
  return check(await supabase.from('admin_notes').insert({ suggestion_id: suggestionId, body }).select('*').single());
}

export async function deleteNote(id: string): Promise<void> {
  check(await supabase.from('admin_notes').delete().eq('id', id));
}

export async function listAdmins(): Promise<Admin[]> {
  return check(await supabase.from('admins').select('*').order('created_at'));
}

export async function addAdmin(email: string): Promise<void> {
  check(await supabase.from('admins').insert({ email: email.trim().toLowerCase() }));
}

export async function removeAdmin(email: string): Promise<void> {
  check(await supabase.from('admins').delete().eq('email', email));
}

export const AUDIT_PAGE = 50;
export async function listAudit(page: number, suggestionId?: string) {
  let q = supabase.from('audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (suggestionId) q = q.eq('suggestion_id', suggestionId);
  const r = await q.range(page * AUDIT_PAGE, page * AUDIT_PAGE + AUDIT_PAGE - 1);
  return { rows: check(r), count: r.count ?? 0 };
}

export async function logExport(format: 'xlsx' | 'docx' | 'backup_json', filters: object, rowCount: number) {
  check(await supabase.rpc('log_export', { p_format: format, p_filters: filters as never, p_row_count: rowCount }));
}

/** Full backup: every non-deleted suggestion and all of their notes (no tracking hashes). */
export async function fullBackup() {
  const suggestions = await allMatching({ ...EMPTY_FILTERS, sort: 'oldest' });
  const notes: Note[] = [];
  for (let i = 0; ; i += 1000) {
    const rows = check(await supabase.from('admin_notes').select('*').order('created_at').range(i, i + 999));
    notes.push(...rows);
    if (rows.length < 1000) break;
  }
  const live = new Set(suggestions.map((s) => s.id));
  return { suggestions, notes: notes.filter((n) => live.has(n.suggestion_id)) };
}

export async function amIAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

/** Human-readable summary of the active filters (used in exports and the audit log). */
export function describeFilters(f: Filters): Record<string, string> {
  const d: Record<string, string> = {};
  if (f.trash) d.view = 'Deleted';
  if (f.q.trim()) d.search = f.q.trim();
  if (f.tags.length) d.priority = f.tags.join(', ');
  if (f.categories.length) d.category = f.categories.join(', ');
  if (f.statuses.length) d.status = f.statuses.join(', ');
  if (f.hasPhoto) d.photo = 'has photo';
  if (f.from) d.from = f.from;
  if (f.to) d.to = f.to;
  d.sort = f.sort;
  return d;
}
