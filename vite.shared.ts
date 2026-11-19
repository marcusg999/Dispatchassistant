/**
 * Shared Vite plugins.
 *
 *  - brandPlugin: exposes `virtual:brand.css` (CSS variables from brand.config.ts)
 *    and replaces %APP_NAME% in HTML, so the brand config drives every page.
 *  - devRoutes: mirrors the production Netlify routing in `vite dev`, so
 *    /s/<key> → portal, /admin/* and /auth/callback → admin, everything else → 404.
 *  - devApi: runs the real Netlify Functions in-process during `vite dev` (no
 *    Netlify CLI needed). Production uses the deployed functions instead.
 */
import type { Plugin, ViteDevServer } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brand, brandCssVars, displayName } from './src/brand/brand.config';

const VIRTUAL = 'virtual:brand.css';
const RESOLVED = '\0virtual:brand.css';

export function brandPlugin(): Plugin {
  return {
    name: 'brand',
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED;
    },
    load(id) {
      if (id === RESOLVED) return brandCssVars(brand);
    },
    transformIndexHtml(html) {
      return html.replaceAll('%APP_NAME%', escapeHtml(displayName(brand)));
    },
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

type Route = 'portal' | 'admin' | '404';

export function routeFor(pathname: string, portalKey: string | undefined): Route {
  if (portalKey && (pathname === `/s/${portalKey}` || pathname === `/s/${portalKey}/`)) return 'portal';
  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/auth/callback') return 'admin';
  return '404';
}

export function devRoutes(which: Route[]): Plugin {
  return {
    name: 'dev-routes',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const p = url.pathname;
        // Let Vite serve its own modules and assets.
        if (
          p.startsWith('/@') ||
          p.startsWith('/src/') ||
          p.startsWith('/node_modules/') ||
          p.startsWith('/api/') ||
          /\.[a-z0-9]+$/i.test(p)
        ) {
          if (p === '/portal.html' || p === '/admin.html') {
            res.statusCode = 404;
            return res.end('Not found');
          }
          return next();
        }
        const route = routeFor(p, process.env.PORTAL_KEY);
        if (route === '404' || !which.includes(route)) {
          res.statusCode = 404;
          res.setHeader('content-type', 'text/html');
          return res.end(readFileSync(resolve('public/404.html'), 'utf8'));
        }
        const file = route === 'portal' ? 'portal.html' : 'admin.html';
        const html = await server.transformIndexHtml(p, readFileSync(resolve(file), 'utf8'));
        res.setHeader('content-type', 'text/html');
        res.end(html);
      });
    },
  };
}

/** Maps /api/* to the function modules, exactly like netlify.toml / function config paths. */
export function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        let mod: string | null = null;
        if (url.pathname === '/api/submit') mod = 'submit';
        else if (url.pathname === '/api/board') mod = 'board';
        else if (url.pathname.startsWith('/api/status/')) mod = 'status';
        if (!mod) return next();
        try {
          const { default: handler } = await server.ssrLoadModule(`/netlify/functions/${mod}.mts`);
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(url.toString(), {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          });
          const response: Response = await handler(request, {});
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          console.error('[dev-api] function crashed', (e as Error).message);
          res.statusCode = 500;
          res.end('{"ok":false}');
        }
      });
    },
  };
}
