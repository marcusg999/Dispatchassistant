/**
 * Shared pieces of the printable portal flyer (used by the admin "Backup & flyer"
 * page and by `npm run flyer`). The QR code is rendered as a plain SVG path from
 * the module matrix, so no inline HTML injection or data: URLs are needed.
 */
import QRCode from 'qrcode';
import { brand } from '../brand/brand.config';

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

/** Flyer copy, derived from the brand config so it rebrands with everything else. */
export const FLYER_COPY = {
  eyebrow: brand.portal.eyebrow,
  headline: brand.portal.headline,
  lines: [
    'No names. No sign-in. No email.',
    `Tell ${brand.officeNoun} what would make the work safer, smoother or fairer.`,
    'Scan the code with your phone camera. It takes under a minute.',
  ],
  footer: brand.portal.promise,
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
