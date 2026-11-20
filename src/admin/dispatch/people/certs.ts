/** Certification status: text labels (never color alone). */
export type CertState = 'expired' | 'soon' | 'ok' | 'none';
export function certState(expires: string | null, today = new Date()): CertState {
  if (!expires) return 'none';
  const [y, m, d] = expires.split('-').map(Number);
  const exp = new Date(y, m - 1, d);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((exp.getTime() - t.getTime()) / 86_400_000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
export const CERT_STATE_LABEL: Record<CertState, string> = { expired: 'Expired', soon: 'Expires soon', ok: 'Valid', none: 'No expiry' };
export function fmtYmd(s: string | null): string {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}
