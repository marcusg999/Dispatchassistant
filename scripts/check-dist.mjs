/**
 * Build guard: fails if anything secret, or anything that doesn't belong in the
 * public portal bundle, ends up in dist/.
 *
 *  - the Supabase secret key value (from env), any `sb_secret_…` key, any JWT with role service_role
 *  - the PORTAL_KEY value anywhere except dist/_redirects (which Netlify never serves)
 *  - in portal assets: supabase-js, the Supabase URL/publishable key, or admin code
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function jwtRoles(text) {
  const roles = [];
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      roles.push(JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role);
    } catch {
      /* not a JWT */
    }
  }
  return roles;
}

const secret = process.env.SUPABASE_SECRET_KEY;
const portalKey = process.env.PORTAL_KEY;
const pubKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supaUrl = process.env.VITE_SUPABASE_URL;

for (const file of walk(DIST)) {
  const rel = relative(DIST, file);
  if (/\.(woff2?|png|jpe?g|webp|ico)$/.test(rel)) continue;
  const text = readFileSync(file, 'utf8');

  if (secret && text.includes(secret)) problems.push(`${rel}: contains SUPABASE_SECRET_KEY`);
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(text)) problems.push(`${rel}: contains an sb_secret_ key`);
  if (jwtRoles(text).includes('service_role')) problems.push(`${rel}: contains a service_role JWT`);
  if (/SUPABASE_SECRET_KEY|SERVICE_ROLE/.test(text) && rel !== '_redirects') problems.push(`${rel}: references the secret key variable`);
  if (portalKey && rel !== '_redirects' && text.includes(portalKey)) problems.push(`${rel}: contains PORTAL_KEY`);

  const isPortal = rel === 'portal.html' || /^assets\/portal-/.test(rel);
  if (isPortal) {
    if (/supabase/i.test(text)) problems.push(`${rel}: portal bundle mentions "supabase"`);
    if (pubKey && text.includes(pubKey)) problems.push(`${rel}: portal bundle contains the publishable key`);
    if (supaUrl && text.includes(supaUrl)) problems.push(`${rel}: portal bundle contains the Supabase URL`);
    if (/hard_delete_suggestion|admin_notes|audit_log/.test(text)) problems.push(`${rel}: portal bundle contains admin code`);
  }
}

if (problems.length) {
  console.error('\n✖ check-dist: refusing to ship this build:\n  ' + problems.join('\n  ') + '\n');
  process.exit(1);
}
console.log('check-dist: OK (no secrets in dist/, portal bundle is Supabase-free)');
