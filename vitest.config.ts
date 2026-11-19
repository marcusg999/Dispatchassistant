import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

/**
 * Two projects:
 *   unit         – pure logic (no services).           npm test
 *   integration  – functions + RLS against `supabase start`.  npm run test:db
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    test: {
      env,
      projects: [
        { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
        {
          extends: true,
          test: {
            name: 'integration',
            include: ['tests/integration/**/*.test.ts', 'tests/rls/**/*.test.ts'],
            environment: 'node',
            fileParallelism: false,
            testTimeout: 20000,
          },
        },
      ],
    },
  };
});
