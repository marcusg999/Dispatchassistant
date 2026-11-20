/**
 * Local development server (`npm run dev`): serves BOTH entry points with the
 * production routing rules and runs the Netlify Functions in-process.
 *
 * Production builds use two isolated configs (vite.portal.config.ts and
 * vite.admin.config.ts) so the portal bundle can never pull in admin code or
 * supabase-js. In dev both use React; the portal build swaps in preact/compat.
 */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { brandPlugin, devApi, devRoutes } from './vite.shared.ts';

export default defineConfig(({ mode }) => {
  // Make .env values (PORTAL_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY…) visible to the in-process functions.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [react(), tailwind(), brandPlugin(), devRoutes(['portal', 'admin', 'quote']), devApi()],
    appType: 'custom',
    server: { port: 5173, strictPort: true },
  };
});
