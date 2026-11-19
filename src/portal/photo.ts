/**
 * Client-side photo scrubbing.
 *
 * Every photo is decoded and re-drawn onto a canvas, then re-encoded. A canvas
 * carries pixels only, so EXIF (GPS, camera serial, timestamps) is dropped.
 * The longest edge is capped at 1600 px and quality is stepped down until the
 * file is ≤ 1.5 MB. Output is WebP where the browser can encode it, else JPEG.
 * The server re-checks type (magic bytes), size and the absence of EXIF.
 */
import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE } from '../shared/domain';

export const ACCEPTED_INPUT = 'image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif';

export class PhotoError extends Error {}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // Applies the EXIF orientation to the pixels, so the photo isn't sideways once EXIF is gone.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img>, which can decode HEIC on Safari */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new PhotoError(
      "This phone can't read that photo format. Try taking a screenshot of the photo and attaching that instead.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function scrubPhoto(file: File): Promise<Blob> {
  if (file.size > 40 * 1024 * 1024) throw new PhotoError('That file is too big to be a photo. Pick a different one.');
  const src = await decode(file);
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  if (!w || !h) throw new PhotoError("That photo couldn't be read.");

  let scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w, h));
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoError("This phone couldn't process the photo.");
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.7, 0.58]) {
      let blob = await toBlob(canvas, 'image/webp', q);
      // Older Safari silently returns PNG for unsupported types; use JPEG then.
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', q);
      if (blob && blob.size <= PHOTO_MAX_BYTES && (blob.type === 'image/webp' || blob.type === 'image/jpeg')) {
        if ('close' in src) src.close();
        return blob;
      }
    }
    scale *= 0.75;
  }
  throw new PhotoError("That photo couldn't be made small enough. Try another one.");
}
