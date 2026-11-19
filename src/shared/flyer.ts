/**
 * Shared pieces of the printable portal flyer (used by the admin "Backup & flyer"
 * page and by `npm run flyer`). The QR code is rendered as a plain SVG path from
 * the module matrix, so no inline HTML injection or data: URLs are needed.
 */
import QRCode from 'qrcode';

export function qrPath(text: string): { size: number; d: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, d };
}

export const FLYER_COPY = {
  eyebrow: 'Suggestion box',
  headline: 'Speak freely.',
  lines: [
    'No names. No sign-in. No email.',
    'Tell the office what would make the work safer, smoother or fairer.',
    'Scan the code with your phone camera. It takes under a minute.',
  ],
  footer: 'Your name is never asked for or stored. Management sees only what you write.',
};

/** Accepts only a portal link of the shape https://host/s/<key>. */
export function isPortalLink(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return (u.protocol === 'https:' || u.hostname === 'localhost') && /^\/s\/[^/]{16,}\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}
