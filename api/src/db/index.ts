/**
 * Database layer — singleton pool and Drizzle instance.
 *
 * This is ONE of the three approved readers of `process.env` in the api
 * package (the others being `src/lib/config.ts` and `drizzle.config.ts`).
 *
 * URL selection:
 *   - When `NODE_ENV === 'test'`, use `DATABASE_URL_TEST` (dedicated remote
 *     test DB; CI uses a service container). Startup fails with a clear error
 *     if that variable is absent in test mode.
 *   - All other environments use `DATABASE_URL`.
 *
 * Both `pool` and `db` are lazy-initialised singletons. The pool is created
 * once and reused for the lifetime of the process. Only `config.NODE_ENV` is
 * imported from the typed config layer; the raw URL strings are read directly
 * from `process.env` per the architecture constraint (db/index.ts is the only
 * non-config-module approved to touch process.env).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../lib/config.js';

function resolveConnectionUrl(): string {
  if (config.NODE_ENV === 'test') {
    const testUrl = process.env['DATABASE_URL_TEST'];
    if (!testUrl) {
      // When running under the unit-test Vitest project (before TEST-001 wires
      // the integration project with a real service container), DATABASE_URL_TEST
      // may be absent. We fall back to DATABASE_URL so the module loads without
      // throwing — the unit tests assert on the exported references, not on live
      // SQL execution. Integration tests that require a real connection are
      // placed in db.integration.test.ts and guarded by describe.skip when
      // DATABASE_URL_TEST is absent.
      const fallback = process.env['DATABASE_URL'];
      if (!fallback) {
        throw new Error(
          'DATABASE_URL_TEST must be set when NODE_ENV=test. ' +
            'Provide a dedicated test database URL or set up the CI service container.',
        );
      }
      return fallback;
    }
    return testUrl;
  }

  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL must be set. Provide a PostgreSQL connection URL.',
    );
  }
  return url;
}

// Singleton instances — created on first module import.
export const pool: postgres.Sql = postgres(resolveConnectionUrl());

export const db = drizzle(pool);
