/**
 * DB-016 test: pii_access_log append-only audit table.
 *
 * Unit tests run always (no DB required).
 * Integration tests are skipped when DATABASE_URL_TEST is not set.
 *
 * Integration tests verify:
 *   - action = 'export' (invalid) is rejected by CHECK constraint
 *   - action = 'read' (valid) inserts successfully
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema/index.js';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

// --- Unit tests (no DB) ---

describe('DB-016: piiAccessLog schema (unit)', () => {
  it('piiAccessLog has actorUserId column', () => {
    expect(Object.keys(schema.piiAccessLog)).toContain('actorUserId');
  });

  it('piiAccessLog has action column', () => {
    expect(Object.keys(schema.piiAccessLog)).toContain('action');
  });

  it('piiAccessLog has resourceType column', () => {
    expect(Object.keys(schema.piiAccessLog)).toContain('resourceType');
  });

  it('piiAccessLog has resourceId column', () => {
    expect(Object.keys(schema.piiAccessLog)).toContain('resourceId');
  });

  it('piiAccessLog has subjectUserId column', () => {
    expect(Object.keys(schema.piiAccessLog)).toContain('subjectUserId');
  });

  it('piiAccessLog has viaGrant column', () => {
    expect(Object.keys(schema.piiAccessLog)).toContain('viaGrant');
  });

  it('piiAccessLog has createdAt column', () => {
    expect(Object.keys(schema.piiAccessLog)).toContain('createdAt');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-016: piiAccessLog integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql`DELETE FROM pii_access_log WHERE actor_user_id LIKE 'user-db-016%'`;
    await sql.end();
  });

  it('rejects action = "export" (invalid value)', async () => {
    await expect(
      db.insert(schema.piiAccessLog).values({
        actorUserId: 'user-db-016-invalid',
        action: 'export',
        resourceType: 'experience',
      }),
    ).rejects.toThrow();
  });

  it('accepts action = "read" (valid value)', async () => {
    const inserted = await db
      .insert(schema.piiAccessLog)
      .values({
        actorUserId: 'user-db-016-reader',
        action: 'read',
        resourceType: 'experience',
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.action).toBe('read');
    expect(inserted[0]!.viaGrant).toBe(false);
    expect(inserted[0]!.resourceId).toBeNull();
    expect(inserted[0]!.subjectUserId).toBeNull();
  });
});
