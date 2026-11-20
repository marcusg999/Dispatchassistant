/**
 * Production build for the CLIENT QUOTE PAGE (/q/:token): a third isolated,
 * sessionless build like the portal. No Supabase client, no admin code, no auth
 * storage; it talks only to /api/quote/*. The PDF generator is lazy-loaded.
 */
import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { brandPlugin } from './vite.shared.ts';

export default defineConfig(() => ({
  plugins: [
    tailwind(),
    brandPlugin(),
    visualizer({ filename: 'dist-stats/quote.html', template: 'treemap', gzipSize: true, emitFile: false }),
    {
      name: 'forbid-admin-imports',
      resolveId(id: string, importer?: string) {
        if (/supabase|[\\/]admin[\\/]|[\\/]portal[\\/]/.test(id) && importer && !importer.includes('node_modules')) {
          throw new Error(`Quote page must not import "${id}" (from ${importer})`);
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
  publicDir: false as const,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: { quote: 'quote.html' },
      output: {
        entryFileNames: 'assets/quote-[hash].js',
        chunkFileNames: 'assets/quote-[hash].js',
        assetFileNames: 'assets/quote-[hash][extname]',
      },
    },
  },
}));
