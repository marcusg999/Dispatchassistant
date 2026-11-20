/**
 * The committed Phase 3 seed must equal what the shared engine generates, so demo data can never drift
 * from the pricing logic. If this fails, regenerate: `node scripts/gen-seed-estimates.mjs` (or equivalent) and commit.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSeedSql, SEED_QUOTE_TOKENS } from '../../scripts/seedEstimates';

const committed = readFileSync(resolve(__dirname, '../../supabase/seed_estimates.sql'), 'utf8');

describe('supabase/seed_estimates.sql', () => {
  it('equals buildSeedSql() from the engine', () => {
    expect(committed).toBe(buildSeedSql());
  });

  it('is deterministic', () => {
    expect(buildSeedSql()).toBe(buildSeedSql());
  });

  it('stores only token hashes, never the raw demo tokens', () => {
    for (const token of Object.values(SEED_QUOTE_TOKENS)) expect(committed).not.toContain(token);
  });

  it('seeds the estimator role and a sample (not production) rate card', () => {
    expect(committed).toContain("'estimator@example.com', 'estimator'");
    expect(committed).toMatch(/is_sample\) values \('SAMPLE: replace with your rates', 'active'/);
    expect(committed).toContain('PLACEHOLDER TERMS');
  });
});
