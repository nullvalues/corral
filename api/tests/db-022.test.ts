/**
 * DB-022 test: Canonical action vocabulary and CHECK constraint for admin_action_log.
 *
 * Unit tests run always (no DB required).
 * Integration tests are skipped when DATABASE_URL_TEST is not set.
 *
 * Integration tests verify:
 *   - admin_action_log has a CHECK constraint named admin_action_log_action_values
 *   - Inserting an out-of-set action value is rejected at the DB layer
 *   - All six canonical values are accepted
 *   - Legacy dotted forms are rejected (grant.create, grant.update, category.create, category.update)
 *
 * Unit tests verify:
 *   - The adminActionLog schema object is exported from audit.ts
 *   - It has the expected columns
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import * as auditSchema from '../src/db/schema/audit.js';

// --- Unit tests (no DB) ---

describe('DB-022: admin_action_log schema (unit)', () => {
  it('adminActionLog is exported from audit schema', () => {
    expect(auditSchema.adminActionLog).toBeDefined();
  });

  it('adminActionLog has action column', () => {
    expect(Object.keys(auditSchema.adminActionLog)).toContain('action');
  });

  it('adminActionLog has actorUserId column', () => {
    expect(Object.keys(auditSchema.adminActionLog)).toContain('actorUserId');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

describe.skipIf(!DATABASE_URL_TEST)('DB-022: admin_action_log CHECK constraint integration', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL_TEST!);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('admin_action_log has a CHECK constraint named admin_action_log_action_values', async () => {
    const rows = await sql<{ conname: string }[]>`
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'admin_action_log'
        AND c.contype = 'c'
        AND c.conname = 'admin_action_log_action_values'
    `;
    expect(rows.length, 'CHECK constraint admin_action_log_action_values not found').toBe(1);
  });

  it('inserting an out-of-set action value is rejected', async () => {
    await expect(
      sql`
        INSERT INTO admin_action_log (actor_user_id, action, resource_type, resource_id)
        VALUES ('test-actor', 'invalid_action', 'test_resource', 'test-id')
      `,
    ).rejects.toThrow();
  });

  it('inserting legacy dotted form grant.create is rejected', async () => {
    await expect(
      sql`
        INSERT INTO admin_action_log (actor_user_id, action, resource_type, resource_id)
        VALUES ('test-actor', 'grant.create', 'mentor_grant', 'test-id')
      `,
    ).rejects.toThrow();
  });

  it('inserting legacy dotted form category.update is rejected', async () => {
    await expect(
      sql`
        INSERT INTO admin_action_log (actor_user_id, action, resource_type, resource_id)
        VALUES ('test-actor', 'category.update', 'experience_category', 'test-id')
      `,
    ).rejects.toThrow();
  });

  it('all six canonical values are accepted', async () => {
    const canonicalValues = [
      'grant_create',
      'grant_update',
      'grant_review',
      'category_create',
      'category_update',
      'role_change',
    ];

    for (const action of canonicalValues) {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO admin_action_log (actor_user_id, action, resource_type, resource_id)
        VALUES ('test-actor-db022', ${action}, 'test_resource', 'test-id-db022')
        RETURNING id
      `;
      expect(rows.length, `canonical action '${action}' should be accepted`).toBe(1);
    }

    // Clean up inserted rows
    await sql`
      DELETE FROM admin_action_log
      WHERE actor_user_id = 'test-actor-db022'
    `;
  });
});
