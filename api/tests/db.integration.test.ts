/**
 * Integration tests for api/src/db/index.ts.
 *
 * These tests require a live PostgreSQL database reachable via DATABASE_URL_TEST.
 * They run in the "integration" Vitest project (TEST-001), which enforces the
 * no-graceful-skip policy: globalSetup throws a clear error if DATABASE_URL_TEST
 * is absent. No describe.skip or hasTestDb guards here.
 */

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('db/index.ts — integration (requires DATABASE_URL_TEST)', () => {
  it('SELECT 1 returns one=1 via Drizzle execute', async () => {
    // Dynamic import so the module is only instantiated (and the pool created)
    // at test execution time, after globalSetup has validated DATABASE_URL_TEST.
    const { db } = await import('../src/db/index.js');
    const result = await db.execute(sql`SELECT 1 as one`);
    // postgres-js returns an array of row objects for raw SQL.
    const rows = result as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // The column value may come back as a string ('1') or number (1) depending
    // on the postgres driver. Coerce to number for the assertion.
    expect(Number(rows[0]?.['one'])).toBe(1);
  });

  it('NODE_ENV=test causes db/index.ts to use DATABASE_URL_TEST', async () => {
    // When NODE_ENV=test, db/index.ts resolves DATABASE_URL_TEST. We verify
    // this by checking that the pool's connection options point to the test DB
    // host/database rather than the production DATABASE_URL.
    const { pool } = await import('../src/db/index.js');
    const testUrl = process.env['DATABASE_URL_TEST']!;
    const parsedTestUrl = new URL(testUrl);

    // postgres-js exposes connection options on the Sql instance. The options
    // object contains the resolved host and database from the URL used to
    // construct the pool.
    // postgres-js stores host as an array to support multiple hosts (multi-host connection strings).
    const poolOptions = (pool as unknown as { options: { host: string | string[]; port: number | number[]; database: string } }).options;
    const hosts = Array.isArray(poolOptions.host) ? poolOptions.host : [poolOptions.host];
    expect(hosts).toContain(parsedTestUrl.hostname);
    expect(poolOptions.database).toBe(parsedTestUrl.pathname.replace(/^\//, ''));
  });
});
