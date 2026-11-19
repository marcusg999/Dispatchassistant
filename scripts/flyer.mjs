/**
 * Printable one-page portal flyer (HTML + PDF), branded from brand.config.ts.
 *
 *   npm run flyer -- https://dispatch-bro-app.netlify.app/s/<PORTAL_KEY>
 *
 * Writes flyer-out/flyer.html and flyer-out/flyer.pdf (git-ignored, because the
 * link contains the secret portal key). Reprint after rotating PORTAL_KEY.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const link = process.argv[2];
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', configFile: false, logLevel: 'error' });
try {
  const { brand, displayName } = await vite.ssrLoadModule('/src/brand/brand.config.ts');
  const { FLYER_COPY, isPortalLink, qrPath } = await vite.ssrLoadModule('/src/shared/flyer.ts');
  if (!link || !isPortalLink(link)) {
    console.error('Usage: npm run flyer -- https://<site>.netlify.app/s/<PORTAL_KEY>');
    process.exit(1);
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const qr = qrPath(link);
  const c = brand.colors;
  const out = resolve('flyer-out');
  mkdirSync(out, { recursive: true });
  copyFileSync('node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2', `${out}/archivo.woff2`);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(displayName(brand))} · Suggestion box</title>
<style>
@font-face{font-family:Archivo;src:url(archivo.woff2) format('woff2');font-weight:100 900;font-stretch:62% 125%}
@page{size:letter;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:${c.paper};color:${c.ink};font-family:Archivo,system-ui,sans-serif}
.page{width:8.5in;height:11in;padding:0.75in;display:flex;flex-direction:column;border-left:0.35in solid ${c.accent}}
.top{display:flex;justify-content:space-between}
.stencil{font-stretch:118%;font-weight:650;letter-spacing:.14em;text-transform:uppercase;font-size:11pt}
.muted{color:${c.muted}}
.eyebrow{color:${c.accentText};margin-top:1.1in}
h1{font-size:88pt;line-height:.86;letter-spacing:-.035em;font-weight:820;margin:.12in 0 0}
ul{list-style:none;padding:0;margin:.4in 0 0;font-size:17pt;line-height:1.35}
li{margin:.06in 0}
.bottom{margin-top:auto;display:flex;gap:.45in;align-items:flex-end}
.qr{width:3.1in;padding:.16in;border:3px solid ${c.ink};background:#fff}
.qr svg{display:block;width:100%;height:auto}
.bar{width:1.2in;height:.16in;background:${c.accent};margin-bottom:.18in}
.promise{font-size:15pt;font-weight:700;line-height:1.3;margin:0}
.link{font-size:8pt;word-break:break-all;margin-top:.15in}
</style></head><body><div class="page">
<div class="top"><span class="stencil">${esc(displayName(brand))}</span><span class="stencil muted">No. 01</span></div>
<p class="stencil eyebrow">${esc(FLYER_COPY.eyebrow)}</p>
<h1>${esc(FLYER_COPY.headline)}</h1>
<ul>${FLYER_COPY.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<div class="bottom">
<div class="qr"><svg viewBox="-2 -2 ${qr.size + 4} ${qr.size + 4}" role="img" aria-label="QR code to the suggestion box"><rect x="-2" y="-2" width="${qr.size + 4}" height="${qr.size + 4}" fill="#fff"/><path d="${qr.d}" fill="${c.ink}" shape-rendering="crispEdges"/></svg></div>
<div><div class="bar"></div><p class="promise">${esc(FLYER_COPY.footer)}</p><p class="link muted">${esc(link)}</p></div>
</div></div></body></html>`;
  writeFileSync(`${out}/flyer.html`, html);

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    ({ chromium } = await import('@playwright/test'));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
  await page.goto(pathToFileURL(`${out}/flyer.html`).href);
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: `${out}/flyer.pdf`, format: 'Letter', printBackground: true });
  await page.screenshot({ path: `${out}/flyer.png`, fullPage: true });
  await browser.close();
  console.log(`Flyer written: ${out}/flyer.html, flyer.pdf, flyer.png`);
} finally {
  await vite.close();
}
