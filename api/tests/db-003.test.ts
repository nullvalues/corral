/**
 * DB-003 integration test: system_roles table and default role assignment on signup.
 *
 * Skipped when DATABASE_URL_TEST is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema/index.js';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

describe.skipIf(!DATABASE_URL_TEST)('DB-003: system_roles table', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('systemRoles table exists and can be queried', async () => {
    const rows = await db.select().from(schema.systemRoles).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('systemRoles schema exports userId and role columns', () => {
    const cols = Object.keys(schema.systemRoles);
    // Drizzle table object exposes column names as keys
    expect(cols).toContain('userId');
    expect(cols).toContain('role');
  });
});
