/**
 * The quote page talks ONLY to these same-origin endpoints. No credentials, no
 * cookies, no browser storage: the unguessable token in the URL is the only key.
 */
import { fromQuoteApi, type QuoteDoc } from '../shared/quote/model';

export function quoteToken(): string {
  const m = location.pathname.match(/^\/q\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export type LoadResult =
  | { kind: 'ok'; quote: QuoteDoc; superseded: boolean }
  | { kind: 'gone' }
  | { kind: 'updating'; message: string }
  | { kind: 'error'; message: string };

const NETWORK = 'No connection. Check your signal and try again.';

export async function loadQuote(token: string): Promise<LoadResult> {
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(token)}`, { credentials: 'omit', cache: 'no-store' });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; quote?: Record<string, unknown> } | null;
    if (res.status === 404 || res.status === 400) return { kind: 'gone' };
    if (res.status === 409) return { kind: 'updating', message: data?.error ?? 'This quote is being updated. Please try again shortly.' };
    if (!res.ok || !data?.ok || !data.quote) return { kind: 'error', message: data?.error ?? 'Something went wrong. Please try again.' };
    return { kind: 'ok', quote: fromQuoteApi(data.quote), superseded: data.quote.superseded === true };
  } catch {
    return { kind: 'error', message: NETWORK };
  }
}

export interface AcceptBody {
  name: string;
  title: string;
  email: string;
  signature: string;
  agree: true;
  terms_version_id: string;
}
export type PostResult = { ok: true } | { ok: false; error: string; code?: string };

async function post(token: string, action: 'accept' | 'decline', body: unknown): Promise<PostResult> {
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(token)}/${action}`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; code?: string } | null;
    if (res.ok && data?.ok) return { ok: true };
    if (res.status === 429) return { ok: false, error: 'Too many attempts. Wait a minute and try again.' };
    return { ok: false, error: data?.error ?? 'Something went wrong. Please try again.', code: data?.code };
  } catch {
    return { ok: false, error: `${NETWORK} Nothing was sent.` };
  }
}

export const acceptQuote = (token: string, body: AcceptBody) => post(token, 'accept', body);
export const declineQuote = (token: string, reason: string) => post(token, 'decline', { reason });
