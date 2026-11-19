/**
 * Server-side photo checks. The browser already re-encoded the image (which strips
 * EXIF/GPS); here we refuse anything that isn't a small JPEG/WebP by magic bytes,
 * and refuse files that still carry EXIF/XMP metadata (e.g. from a modified client).
 */
import { PHOTO_MAX_BYTES } from '../../src/shared/domain';

export type PhotoKind = { ext: 'jpg'; mime: 'image/jpeg' } | { ext: 'webp'; mime: 'image/webp' };

export function sniffImage(b: Uint8Array): PhotoKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP'
  )
    return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** True if the JPEG has an APP1 Exif/XMP segment, or the WebP has an EXIF/XMP chunk. */
export function hasMetadata(b: Uint8Array, kind: PhotoKind): boolean {
  if (kind.ext === 'jpg') {
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return false;
      const marker = b[i + 1];
      if (marker === 0xda || marker === 0xd9) return false; // start of scan / end: no more headers
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker === 0xe1) {
        const id = String.fromCharCode(...b.subarray(i + 4, i + 10));
        if (id.startsWith('Exif') || id.startsWith('http:')) return true;
      }
      i += 2 + len;
    }
    return false;
  }
  // WebP: walk RIFF chunks
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const size = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    if (fourcc === 'EXIF' || fourcc === 'XMP ') return true;
    i += 8 + size + (size & 1);
  }
  return false;
}

export type PhotoCheck = { ok: true; kind: PhotoKind; bytes: Uint8Array } | { ok: false; status: number; error: string };

export async function checkPhoto(file: File): Promise<PhotoCheck> {
  if (file.size === 0) return { ok: false, status: 400, error: 'The photo was empty.' };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, status: 413, error: 'That photo is too large.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, status: 415, error: 'That file is not a supported photo.' };
  if (hasMetadata(bytes, kind))
    return { ok: false, status: 422, error: 'That photo still contains hidden details. Please re-attach it.' };
  return { ok: true, kind, bytes };
}
