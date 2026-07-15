/**
 * Unit tests for api/src/db/index.ts.
 *
 * These tests verify module-level behaviour (singleton reference identity,
 * exported shape) without executing real SQL. The integration counterparts
 * that run SELECT 1 live in db.integration.test.ts (TEST-001 wires the
 * Vitest project split that routes them to a real service container).
 *
 * Because db/index.ts creates a postgres-js pool at module load time, we
 * import it directly and assert on the exported references. The vitest env
 * pre-seeds DATABASE_URL and DATABASE_URL_TEST so the module can load without
 * throwing (see vitest.config.ts).
 */

import { describe, expect, it } from 'vitest';

describe('db/index.ts — module shape', () => {
  it('exports a pool (postgres-js Sql instance)', async () => {
    const { pool } = await import('../src/db/index.js');
    expect(pool).toBeDefined();
    // postgres-js Sql instances are callable functions with options attached.
    expect(typeof pool).toBe('function');
  });

  it('exports a db (Drizzle instance)', async () => {
    const { db } = await import('../src/db/index.js');
    expect(db).toBeDefined();
    expect(typeof db).toBe('object');
  });

  it('pool and db are singletons (same reference on repeated import)', async () => {
    const first = await import('../src/db/index.js');
    const second = await import('../src/db/index.js');
    expect(first.pool).toBe(second.pool);
    expect(first.db).toBe(second.db);
  });
});
