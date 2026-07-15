/**
 * Test-DB lifecycle harness — safety-guarded to the test database.
 *
 * Exports four operations:
 *   fullClean()        — DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public; re-migrate
 *   dataClean()        — TRUNCATE all app tables RESTART IDENTITY CASCADE
 *   wipe(tables)       — DROP named tables CASCADE; re-migrate
 *   seed()             — insert test reference data (no-op for Phase 1–4)
 *
 * SAFETY GUARD: every function checks BOTH conditions before running any SQL:
 *   1. config.NODE_ENV === 'test'  (typed config — NOT process.env)
 *   2. pool.options.database contains 'test'  (actual resolved DB name)
 *
 * process.env is NOT read anywhere in this file. The env-containment rule
 * restricts process.env to src/lib/config.ts, src/db/index.ts, and
 * drizzle.config.ts only. The config + pool imports satisfy the guard
 * without violating that rule.
 *
 * CLI: `tsx src/db/testdb.ts <verb> [args]`
 *   full-clean        → fullClean()
 *   data-clean        → dataClean()
 *   wipe <t1,t2,...>  → wipe(tables)
 *   seed              → seed()
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { config } from '../lib/config.js';
import { pool } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// One migration folder path — same as tests/globalSetup.ts, one code path.
const MIGRATIONS_FOLDER = path.join(__dirname, '../../drizzle');

// The drizzle migration journal table is excluded from data-clean truncation.
const DRIZZLE_JOURNAL_TABLE = '__drizzle_migrations';

/**
 * Asserts that the current environment and connected database are both safe
 * for destructive test operations. Throws with a clear message if either
 * condition fails.
 *
 * Called as the FIRST statement in every exported function, before any SQL.
 */
function assertTestDb(): void {
  if (config.NODE_ENV !== 'test') {
    throw new Error(
      `testdb: refusing to run — NODE_ENV is '${config.NODE_ENV}', must be 'test'. ` +
        'Run with NODE_ENV=test and a dedicated test database.',
    );
  }

  const dbName = pool.options.database;
  if (!dbName.includes('test')) {
    throw new Error(
      `testdb: refusing to run — connected database is '${dbName}', which does not ` +
        "contain 'test'. Set DATABASE_URL_TEST to a test database URL " +
        '(e.g. postgresql://asp:asp@localhost:5432/asp_test).',
    );
  }
}

/**
 * Drops and recreates the public schema AND the Drizzle migration journal
 * schema, then re-applies all migrations from scratch. Repairs schema drift
 * and guarantees a clean starting state.
 *
 * The Drizzle migration journal lives in a separate `drizzle` schema
 * (`drizzle.__drizzle_migrations`) by default. Dropping only `public` leaves
 * the journal intact, so `migrate()` sees all entries as already-applied and
 * no-ops — leaving `public` empty. We must drop BOTH schemas so the migrator
 * re-applies every migration.
 *
 * CLI verb: full-clean
 */
export async function fullClean(): Promise<void> {
  assertTestDb();

  await pool`DROP SCHEMA IF EXISTS public CASCADE`;
  await pool`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await pool`CREATE SCHEMA public`;

  const migrationDb = drizzle(pool);
  await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Truncates every application table in the public schema with RESTART IDENTITY
 * CASCADE. The Drizzle migration journal is excluded so schema history is
 * preserved. Schema structure is untouched.
 *
 * CLI verb: data-clean
 */
export async function dataClean(): Promise<void> {
  assertTestDb();

  // Discover all base tables in the public schema.
  const rows = await pool<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `;

  const tables = rows
    .map((r) => r.table_name)
    .filter((name) => name !== DRIZZLE_JOURNAL_TABLE);

  if (tables.length === 0) {
    return;
  }

  // Build a single TRUNCATE statement for all tables.
  const tableList = tables.map((t) => `"${t}"`).join(', ');
  await pool.unsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}

/**
 * Drops the specified tables CASCADE, then re-applies all Drizzle migrations
 * to restore the schema for those tables. Useful for repairing one domain
 * without a full rebuild.
 *
 * CLI verb: wipe <t1,t2,...>
 */
export async function wipe(tables: string[]): Promise<void> {
  assertTestDb();

  for (const table of tables) {
    await pool.unsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }

  const migrationDb = drizzle(pool);
  await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Inserts test reference data. No-op for Phase 1–4 (tests in this range need
 * no seed data). Phase 5 extends this to insert categories from DB-015's seed.
 *
 * CLI verb: seed
 */
export async function seed(): Promise<void> {
  assertTestDb();
  // No-op until Phase 5.
}

// ---------------------------------------------------------------------------
// CLI dispatcher — only runs when invoked directly (not imported as a module).
// ---------------------------------------------------------------------------

// ESM-correct direct-invocation guard. process.argv[2] is unreliable in ESM
// because module loaders (Vitest, tsx) set argv[1] to the loader itself, not
// this file, and argv[2] may be a loader flag (e.g. '--run') rather than a
// CLI verb. Compare import.meta.url against argv[1] instead.
const isDirectInvocation =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  new URL(import.meta.url).pathname === new URL(process.argv[1], import.meta.url).pathname;

if (isDirectInvocation) {
  const verb = process.argv[2];
  (async () => {
    try {
      switch (verb) {
        case 'full-clean':
          await fullClean();
          break;

        case 'data-clean':
          await dataClean();
          break;

        case 'wipe': {
          const arg = process.argv[3];
          if (!arg) {
            throw new Error('wipe requires a comma-separated table list as argv[3]');
          }
          const tables = arg.split(',').map((t) => t.trim()).filter(Boolean);
          await wipe(tables);
          break;
        }

        case 'seed':
          await seed();
          break;

        default:
          throw new Error(
            `Unknown verb '${verb}'. Valid verbs: full-clean, data-clean, wipe, seed.`,
          );
      }

      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error('[testdb]', err instanceof Error ? err.message : err);
      await pool.end().catch(() => {
        // ignore end errors on failure path
      });
      process.exit(1);
    }
  })();
}
