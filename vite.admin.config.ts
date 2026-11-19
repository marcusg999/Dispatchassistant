/** Production build for the private admin console (React + supabase-js, publishable key only). */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { brandPlugin } from './vite.shared.ts';

export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    brandPlugin(),
    visualizer({ filename: 'dist-stats/admin.html', template: 'treemap', gzipSize: true, emitFile: false }),
  ],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
    // exceljs + docx are lazy-loaded on first export; that chunk is large by nature.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { admin: 'admin.html' },
      output: {
        entryFileNames: 'assets/admin-[hash].js',
        chunkFileNames: 'assets/admin-[hash].js',
        assetFileNames: 'assets/admin-[hash][extname]',
      },
    },
  },
});
