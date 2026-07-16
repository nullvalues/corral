/**
 * Vitest config for @asp/api.
 *
 * As of INFRA-037 (vitest v3 migration), the two test projects previously
 * defined in vitest.workspace.ts are consolidated here using the new
 * `test.projects` API (vitest v3 replaces the deprecated workspace file).
 *
 * Defines two test projects:
 *
 *   unit        — all *.test.ts files EXCEPT *.integration.test.ts
 *                 No DATABASE_URL_TEST required. Pre-seeds env so config.ts
 *                 module-load validation passes on static imports.
 *
 *   integration — *.integration.test.ts only
 *                 Requires DATABASE_URL_TEST (enforced by globalSetup at
 *                 tests/globalSetup.ts — fails loud, no graceful skip).
 *                 Pre-seeds the same boot-time env as unit (config validation
 *                 runs at module load time for shared imports).
 *
 * Scripts (api/package.json):
 *   test              → vitest --run            (all projects)
 *   test:unit         → vitest --run --project unit
 *   test:integration  → vitest --run --project integration
 *
 * CI strategy (TEST-001):
 *   - "api test" step runs test:unit (no DB required)
 *   - "api integration tests" step runs test:integration with a Postgres
 *     service container providing DATABASE_URL_TEST
 *
 * `env` pre-seeding rationale:
 * config.ts validates process.env at module load time and throws ConfigError on
 * any failure. Any test file that statically imports app.ts (or anything in its
 * module graph) would trigger the validator before per-case vi.stubEnv calls in
 * beforeEach can run. These defaults are the boot-time floor, not the test
 * contract.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadDatabaseUrlTest } from './tests/loadDatabaseUrlTest.js';

// Cold-shell build gate (TEST-056, resolves CER-039): load ONLY
// DATABASE_URL_TEST from the repo-root .env.local so `pnpm typecheck && pnpm test`
// runs green from a cold shell with neither DATABASE_URL_TEST nor NODE_ENV exported.
// vitest.config.ts is evaluated in the main process before globalSetup runs and
// before worker processes are forked (workers inherit this env), so setting
// process.env.DATABASE_URL_TEST here makes it available to globalSetup, to
// db/index.ts's test-URL selection in workers, and to the per-project env blocks.
//
// SINGLE-KEY WHITELIST: only DATABASE_URL_TEST is read. The dev DATABASE_URL and
// NODE_ENV=development in that file are deliberately NOT loaded — leaking them
// could point an integration run at the dev database. The loader no-ops when the
// file is absent (CI exports DATABASE_URL_TEST via its Postgres service
// container) and never overrides an already-exported value.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDatabaseUrlTest(path.join(__dirname, '..', '.env.local'));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.integration.test.ts', 'tests/api-integration.test.ts'],
          env: {
            PORT: '6050',
            SESSION_SECRET: 'a'.repeat(64),
            ALLOWED_ORIGINS: 'http://localhost:6051',
            NODE_ENV: 'test',
            MFA_ENABLED: 'true',
            DATABASE_URL: 'postgresql://asp:asp@localhost:5432/asp',
            DATABASE_URL_TEST: '',
          },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/**/*.integration.test.ts', 'tests/api-integration.test.ts'],
          globalSetup: ['tests/globalSetup.ts'],
          testTimeout: 30000,
          //
          // Serialise integration test files so they cannot interleave against
          // the shared test database. Root cause of the flakiness repaired by
          // TEST-055: all integration files share one test DB; dataClean() is
          // called exactly once in globalSetup before any file loads, and
          // individual files do not truncate rows between themselves. When
          // multiple files execute concurrently they observe each other's rows,
          // causing state-sensitive tests (e.g. api-030 last-admin guard,
          // api-032 grant review queue) to see unexpected row counts and fail.
          // The unit project is unaffected and remains fully parallel.
          fileParallelism: false,
          env: {
            PORT: '6050',
            SESSION_SECRET: 'a'.repeat(64),
            ALLOWED_ORIGINS: 'http://localhost:6051',
            NODE_ENV: 'test',
            MFA_ENABLED: 'true',
            // DATABASE_URL intentionally omitted — integration tests must use
            // DATABASE_URL_TEST (enforced by globalSetup and by db/index.ts
            // test-mode URL selection logic).
          },
        },
      },
    ],
  },
});
