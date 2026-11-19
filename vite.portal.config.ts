/**
 * Production build for the PUBLIC portal only.
 * - Separate module graph: nothing under src/admin and no supabase-js can be bundled.
 * - React API via preact/compat to keep the portal well under the 150 KB JS budget.
 * - `npm run build:portal -- --mode analyze` writes dist-stats/portal.html (bundle analyzer).
 */
import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { brandPlugin } from './vite.shared';

export default defineConfig(() => ({
  plugins: [
    tailwind(),
    brandPlugin(),
    visualizer({ filename: 'dist-stats/portal.html', template: 'treemap', gzipSize: true, emitFile: false }),
    {
      name: 'forbid-admin-imports',
      resolveId(id, importer) {
        if (/supabase|[\\/]admin[\\/]/.test(id) && importer && !importer.includes('node_modules')) {
          throw new Error(`Portal must not import "${id}" (from ${importer})`);
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
      { find: /^react-dom$/, replacement: 'preact/compat' },
      { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-dev-runtime' },
      { find: /^react$/, replacement: 'preact/compat' },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: { portal: 'portal.html' },
      output: {
        entryFileNames: 'assets/portal-[hash].js',
        chunkFileNames: 'assets/portal-[hash].js',
        assetFileNames: 'assets/portal-[hash][extname]',
      },
    },
  },
}));
