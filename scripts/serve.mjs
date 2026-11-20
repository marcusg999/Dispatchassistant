/**
 * Local production-like server for E2E tests and previews:
 * serves dist/ with the same routing rules as dist/_redirects and runs the real
 * Netlify Functions in-process (via Vite's SSR loader, so TypeScript just works).
 *
 *   node scripts/serve.mjs [port]
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer as createVite, loadEnv } from 'vite';

Object.assign(process.env, loadEnv('production', process.cwd(), ''), process.env);
const port = Number(process.argv[2] ?? 8888);
const DIST = 'dist';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

// Parse the generated _redirects (simple, exact + /* splat rules).
const rules = readFileSync(join(DIST, '_redirects'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const [from, to, status] = l.trim().split(/\s+/);
    return { from, to, status: parseInt(status, 10) };
  });

const vite = await createVite({ server: { middlewareMode: true }, appType: 'custom', configFile: false, logLevel: 'error' });
const fnFor = (p) => (p === '/api/submit' ? 'submit' : p === '/api/board' ? 'board' : p === '/api/incident-photo' ? 'incident-photo' : p.startsWith('/api/status/') ? 'status' : p.startsWith('/api/estimate/') ? 'estimate' : p.startsWith('/api/quote/') ? 'quote' : null);

function sendFile(res, file, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const p = decodeURIComponent(url.pathname);

    const fn = fnFor(p);
    if (fn) {
      const { default: handler } = await vite.ssrLoadModule(`/netlify/functions/${fn}.mts`);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const r = await handler(
        new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }),
        { params: fn === 'status' ? { hash: p.split('/').pop() } : {} },
      );
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }

    for (const r of rules) {
      const match = r.from.endsWith('/*') ? p.startsWith(r.from.slice(0, -1)) || p === r.from.slice(0, -2) : p === r.from;
      if (match) return sendFile(res, join(DIST, r.to), r.status);
    }
    const file = normalize(join(DIST, p));
    if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile() && !p.startsWith('/_')) return sendFile(res, file);
    return sendFile(res, join(DIST, '404.html'), 404);
  })
  .listen(port, () => console.log(`serving dist on http://localhost:${port}`));
