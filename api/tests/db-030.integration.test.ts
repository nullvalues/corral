/**
 * DB-030 integration test: admin_action_log CHECK constraint extended with category_delete.
 *
 * Requires a live PostgreSQL test database (DATABASE_URL_TEST).
 *
 * Covers (DB-030 Ensures):
 * - An admin_action_log insert with action = 'category_delete' succeeds.
 * - An insert with an unknown action (e.g. 'bogus_action') is rejected by the CHECK.
 */

import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('DB-030: admin_action_log category_delete CHECK constraint (integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeAll(async () => {
    const mod = await import('../src/db/index.js');
    db = mod.db;
    // Clean up any leftover rows from previous runs
    await db.execute(sql`DELETE FROM admin_action_log WHERE actor_user_id = 'test-actor-db030'`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM admin_action_log WHERE actor_user_id = 'test-actor-db030'`);
  });

  it('inserting action = category_delete succeeds', async () => {
    const rows = await db.execute(sql`
      INSERT INTO admin_action_log (actor_user_id, action, resource_type, resource_id)
      VALUES ('test-actor-db030', 'category_delete', 'experience_category', 'test-id-db030')
      RETURNING id
    `);
    expect(rows.length, "action 'category_delete' should be accepted by the CHECK").toBeGreaterThan(0);
  });

  it('inserting an unknown action (bogus_action) is rejected by the CHECK', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO admin_action_log (actor_user_id, action, resource_type, resource_id)
        VALUES ('test-actor-db030', 'bogus_action', 'experience_category', 'test-id-db030')
      `),
    ).rejects.toThrow();
  });
});
