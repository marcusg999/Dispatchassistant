/**
 * Optional Cloudflare Turnstile verification (OFF unless TURNSTILE_SECRET_KEY is set).
 * We deliberately do NOT send the client IP (`remoteip`) to Cloudflare.
 */
export async function verifyTurnstile(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
