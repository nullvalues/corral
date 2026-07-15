/**
 * DB-029 integration test: mentor_grants_active_pair_uq partial unique index.
 *
 * Requires a live PostgreSQL test database (DATABASE_URL_TEST).
 *
 * Covers (DB-029 Ensures):
 * - Inserting a second active grant for the same (mentor, applicant) pair fails
 *   with a unique-violation error.
 * - Inserting a new active grant after the first is set to revoked succeeds.
 */

import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('DB-029: mentor_grants_active_pair_uq partial unique index (integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeAll(async () => {
    const mod = await import('../src/db/index.js');
    db = mod.db;
    // Clean up any leftover rows from previous runs
    await db.execute(sql`DELETE FROM mentor_grants WHERE id LIKE 'db029-%'`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM mentor_grants WHERE id LIKE 'db029-%'`);
  });

  it('inserting a second active grant for the same (mentor, applicant) pair fails', async () => {
    // Insert the first active grant — must succeed
    await db.execute(sql`
      INSERT INTO mentor_grants (id, applicant_user_id, mentor_user_id, granted_by_user_id, status, permissions)
      VALUES (
        'db029-grant-1',
        'db029-applicant',
        'db029-mentor',
        'db029-admin',
        'active',
        '{}'
      )
    `);

    // Insert a second active grant for the same pair — must fail with a unique violation
    await expect(
      db.execute(sql`
        INSERT INTO mentor_grants (id, applicant_user_id, mentor_user_id, granted_by_user_id, status, permissions)
        VALUES (
          'db029-grant-2',
          'db029-applicant',
          'db029-mentor',
          'db029-admin',
          'active',
          '{}'
        )
      `),
    ).rejects.toThrow();
  });

  it('inserting a new active grant after the first is revoked succeeds', async () => {
    // Revoke the first grant
    await db.execute(sql`
      UPDATE mentor_grants
      SET status = 'revoked'
      WHERE id = 'db029-grant-1'
    `);

    // Now a new active grant for the same pair should be allowed
    await expect(
      db.execute(sql`
        INSERT INTO mentor_grants (id, applicant_user_id, mentor_user_id, granted_by_user_id, status, permissions)
        VALUES (
          'db029-grant-3',
          'db029-applicant',
          'db029-mentor',
          'db029-admin',
          'active',
          '{}'
        )
      `),
    ).resolves.toBeDefined();
  });
});
