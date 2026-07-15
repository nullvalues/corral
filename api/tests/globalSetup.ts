/**
 * Vitest globalSetup for the integration test project (TEST-001).
 *
 * Runs once before any integration test file is loaded. Applies all Drizzle
 * migrations to the test database so every integration test starts against a
 * schema-current DB, then performs a data clean (truncate all application
 * tables, RESTART IDENTITY CASCADE) so every run starts with zero rows
 * (TEST-009).
 *
 * NO GRACEFUL SKIP: if DATABASE_URL_TEST is absent, this throws immediately
 * with a clear error. The integration project is not runnable without a DB.
 * Unit tests (project "unit") never invoke this file.
 *
 * DYNAMIC IMPORTS: globalSetup runs in the Vitest main process, not in test
 * workers. The `env` block in vitest.workspace.ts only populates env vars for
 * test workers. We must patch the required env vars here — before any import
 * that transitively loads config.ts — then use dynamic import() so modules
 * load after the env is ready (TEST-009, CRITICAL 1).
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setup() {
  const dbUrl = process.env['DATABASE_URL_TEST'];
  if (!dbUrl) {
    throw new Error(
      'DATABASE_URL_TEST is required for integration tests — ' +
        'CI must provide a Postgres service container; ' +
        'locally, point at a dedicated test DB. No graceful skip.',
    );
  }

  // Patch env vars before any dynamic import that loads config.ts.
  // config.ts validates SESSION_SECRET (≥64 chars), ALLOWED_ORIGINS, and
  // DATABASE_URL at module load time. These stubs satisfy the validators
  // without overwriting any value the caller may have already set.
  // Integration globalSetup must ALWAYS run as test — there is no scenario where
  // it should honour a dev NODE_ENV. The independent DB-name guard in
  // assertTestDb() still protects which database is targeted, so forcing this is
  // safe. Without the force, a stray NODE_ENV=development in the shell makes
  // assertTestDb() refuse to run (CER-039).
  process.env['NODE_ENV'] = 'test';
  process.env['SESSION_SECRET'] ||= 'a'.repeat(64);
  process.env['ALLOWED_ORIGINS'] ||= 'http://localhost';
  // config.ts reads DATABASE_URL (not DATABASE_URL_TEST); point it at the
  // test DB so the pool in db/index.ts connects to the right place.
  process.env['DATABASE_URL'] ||= dbUrl;

  // Dynamic imports deferred until env is patched.
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const postgres = (await import('postgres')).default;
  const { dataClean } = await import('../src/db/testdb.js');

  // Use a dedicated one-connection pool for the migration step. dataClean()
  // uses the shared pool from db/index.ts (which points at DATABASE_URL_TEST
  // via the DATABASE_URL stub above).
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);

  await migrate(db, {
    migrationsFolder: path.join(__dirname, '../drizzle'),
  });

  await sql.end();

  // Truncate all application tables so the run starts with zero rows.
  // dataClean() uses the shared pool; close it after the operation.
  await dataClean();

  const { pool } = await import('../src/db/index.js');
  await pool.end();
}
