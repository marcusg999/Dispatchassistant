import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkPhoto, hasMetadata, sniffImage } from '../../netlify/lib/image';

const gps = new Uint8Array(readFileSync('tests/fixtures/gps.jpg'));
const webp = new Uint8Array(readFileSync('tests/fixtures/clean.webp'));

describe('server photo checks', () => {
  it('sniffs JPEG and WebP by magic bytes, nothing else', () => {
    expect(sniffImage(gps)?.mime).toBe('image/jpeg');
    expect(sniffImage(webp)?.mime).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // PNG not accepted
  });

  it('detects EXIF in a JPEG and accepts a clean WebP', () => {
    expect(hasMetadata(gps, { ext: 'jpg', mime: 'image/jpeg' })).toBe(true);
    expect(hasMetadata(webp, { ext: 'webp', mime: 'image/webp' })).toBe(false);
  });

  it('rejects oversized, non-image and EXIF-bearing uploads', async () => {
    expect((await checkPhoto(new File([new Uint8Array(1_600_000)], 'a.jpg'))).ok).toBe(false);
    const html = await checkPhoto(new File(['<html>'], 'a.jpg'));
    expect(html.ok === false && html.status).toBe(415);
    const big = await checkPhoto(new File([gps], 'gps.jpg'));
    expect(big.ok).toBe(false); // 362 KB but still carries EXIF → rejected
    expect(big.ok === false && big.status).toBe(422);
    expect((await checkPhoto(new File([webp], 'x.webp'))).ok).toBe(true);
  });
});
