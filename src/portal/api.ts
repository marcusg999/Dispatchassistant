/**
 * The portal talks ONLY to these three same-origin Netlify Functions.
 * No Supabase client, no keys. The portal key comes from the URL path (/s/<key>)
 * and is sent as a header so it never lands in query-string logs.
 */
import type { Category, Status } from '../shared/domain';

export function portalKey(): string {
  const m = location.pathname.match(/^\/s\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const headers = () => ({ 'x-portal-key': portalKey() });

export type SubmitResult = { ok: true } | { ok: false; error: string };

export async function submitSuggestion(form: FormData): Promise<SubmitResult> {
  try {
    const res = await fetch('/api/submit', { method: 'POST', headers: headers(), body: form });
    if (res.ok) return { ok: true };
    if (res.status === 429) return { ok: false, error: 'Too many sends from this network. Wait a minute and try again.' };
    if (res.status === 413) return { ok: false, error: 'That photo is too large. Try a different one.' };
    if (res.status === 404 || res.status === 403)
      return { ok: false, error: 'This link has expired. Ask the office for the current flyer or link.' };
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: data?.error ?? 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, error: 'No connection. Check your signal and try again. Nothing was sent.' };
  }
}

export interface StatusResponse {
  status: Status;
  public_reply: string | null;
  updated_at: string;
}

export async function fetchStatus(hash: string): Promise<StatusResponse | 'not_found' | 'error'> {
  try {
    const res = await fetch(`/api/status/${hash}`, { headers: headers() });
    if (res.status === 404) return 'not_found';
    if (!res.ok) return 'error';
    return (await res.json()) as StatusResponse;
  } catch {
    return 'error';
  }
}

export interface BoardItem {
  board_summary: string;
  category: Category;
  status: Status;
  date: string;
}

export async function fetchBoard(): Promise<BoardItem[] | 'error'> {
  try {
    const res = await fetch('/api/board', { headers: headers() });
    if (!res.ok) return 'error';
    const data = (await res.json()) as { items: BoardItem[] };
    return data.items;
  } catch {
    return 'error';
  }
}
