import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brand, brandCssVars, displayName } from '../../src/brand/brand.config';
import { contrast } from '../../src/shared/contrast';

describe('brand config', () => {
  const c = brand.colors;
  it.each([
    ['ink on paper', c.ink, c.paper],
    ['ink on wall', c.ink, c.wall],
    ['muted on paper', c.muted, c.paper],
    ['muted on wall', c.muted, c.wall],
    ['ink on accent (buttons)', c.ink, c.accent],
    ['accentText on paper', c.accentText, c.paper],
    ['accentText on wall', c.accentText, c.wall],
    ['danger on paper', c.danger, c.paper],
    ['just sayin tag', brand.tagColors.just_sayin.fg, brand.tagColors.just_sayin.bg],
    ['casual tag', brand.tagColors.casual.fg, brand.tagColors.casual.bg],
    ['important tag', brand.tagColors.important.fg, brand.tagColors.important.bg],
    ['urgent tag', brand.tagColors.urgent.fg, brand.tagColors.urgent.bg],
    ['crucial tag', brand.tagColors.crucial.fg, brand.tagColors.crucial.bg],
  ])('%s meets WCAG AA (4.5:1)', (_n, a, b) => {
    expect(contrast(a, b)).toBeGreaterThanOrEqual(4.5);
  });

  describe('dark palette', () => {
    const d = brand.darkColors;
    const t = brand.darkTagColors;
    it.each([
      ['ink on paper', d.ink, d.paper],
      ['ink on wall', d.ink, d.wall],
      ['muted on paper', d.muted, d.paper],
      ['muted on wall', d.muted, d.wall],
      ['onAccent on accent (buttons)', d.onAccent, d.accent],
      ['accentText on paper', d.accentText, d.paper],
      ['accentText on wall', d.accentText, d.wall],
      ['danger on paper', d.danger, d.paper],
      ['danger on wall', d.danger, d.wall],
      ['just sayin tag', t.just_sayin.fg, t.just_sayin.bg],
      ['casual tag', t.casual.fg, t.casual.bg],
      ['important tag', t.important.fg, t.important.bg],
      ['urgent tag', t.urgent.fg, t.urgent.bg],
      ['crucial tag', t.crucial.fg, t.crucial.bg],
    ])('dark: %s meets WCAG AA (4.5:1)', (_n, a, b) => {
      expect(contrast(a, b)).toBeGreaterThanOrEqual(4.5);
    });
    it('dark: focus ring and hairlines are visible against the wall', () => {
      expect(contrast(d.focus, d.wall)).toBeGreaterThanOrEqual(3);
      expect(contrast(d.focus, d.paper)).toBeGreaterThanOrEqual(3);
    });
    it('light: onAccent on accent meets AA', () => {
      expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    });
    it('dark and light palettes have the same keys', () => {
      expect(Object.keys(d).sort()).toEqual(Object.keys(c).sort());
      expect(Object.keys(t).sort()).toEqual(Object.keys(brand.tagColors).sort());
    });
    it('emits dark rules for data-theme and prefers-color-scheme; light-only build omits them', () => {
      const css = brandCssVars();
      expect(css).toContain(':root[data-theme="dark"]');
      expect(css).toContain('@media (prefers-color-scheme: dark){:root:not([data-theme="light"])');
      for (const v of Object.values(d)) expect(css).toContain(v);
      expect(brandCssVars(brand, { dark: false })).not.toContain('dark');
    });
  });

  it('focus ring is visible against the wall (≥3:1)', () => {
    expect(contrast(c.focus, c.wall)).toBeGreaterThanOrEqual(3);
  });

  it('emits CSS variables for every color', () => {
    const css = brandCssVars();
    for (const v of Object.values(c)) expect(css).toContain(v);
  });

  it('displayName omits an empty company name', () => {
    expect(displayName({ ...brand, companyName: '' })).toBe(brand.appName);
    expect(displayName({ ...brand, companyName: 'Acme Fine Art' })).toBe(`${brand.appName} · Acme Fine Art`);
  });

  it('no company name is hardcoded outside brand.config.ts', () => {
    // Every user-facing string must come from the config; the app name may only appear there.
    const files: string[] = [];
    const walk = (d: string) =>
      readdirSync(d).forEach((f) => {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|html|css)$/.test(f)) files.push(p);
      });
    walk('src');
    walk('netlify');
    for (const f of [...files, 'portal.html', 'admin.html', 'public/404.html']) {
      if (f.endsWith('brand.config.ts')) continue;
      expect(readFileSync(f, 'utf8'), f).not.toContain(brand.appName);
    }
  });
});
