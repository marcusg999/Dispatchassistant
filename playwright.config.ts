import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Test helpers read local Supabase keys from .env.
if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * E2E against the production build served by scripts/serve.mjs (same routing as
 * Netlify, real functions, local Supabase). Prereqs: `npx supabase start` and a
 * .env with the local values (see README → Local development).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://localhost:8888', trace: 'off' },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'npm run build && node scripts/serve.mjs 8888',
    url: 'http://localhost:8888/admin',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
