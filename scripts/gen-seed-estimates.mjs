/**
 * Generates supabase/seed_estimates.sql from the shared engine, so seeded prices are
 * real engine output (never hand-typed numbers). Re-run after engine or SAMPLE rate changes:
 *   node scripts/gen-seed-estimates.mjs
 * A unit test checks the committed file is up to date.
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', configFile: false, logLevel: 'error' });
try {
  const m = await vite.ssrLoadModule('/scripts/seedEstimates.ts');
  writeFileSync('supabase/seed_estimates.sql', m.buildSeedSql());
  console.log('wrote supabase/seed_estimates.sql');
} finally {
  await vite.close();
}
