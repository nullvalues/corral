/**
 * DB-017 test: value CHECK constraints on system_roles.role and mentor_grants.status.
 *
 * Unit tests run always (no DB required).
 * Integration tests are skipped when DATABASE_URL_TEST is not set.
 *
 * Integration tests verify:
 *   - system_roles with role = 'superuser' is rejected by CHECK constraint
 *   - mentor_grants with status = 'pending' is rejected by CHECK constraint
 *   - Valid role and status values are accepted
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema/index.js';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

// --- Unit tests (no DB) ---

describe('DB-017: systemRoles schema (unit)', () => {
  it('systemRoles has userId column', () => {
    expect(Object.keys(schema.systemRoles)).toContain('userId');
  });

  it('systemRoles has role column', () => {
    expect(Object.keys(schema.systemRoles)).toContain('role');
  });
});

describe('DB-017: mentorGrants schema (unit)', () => {
  it('mentorGrants has status column', () => {
    expect(Object.keys(schema.mentorGrants)).toContain('status');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-017: system_roles CHECK integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql`DELETE FROM system_roles WHERE user_id LIKE 'user-db-017%'`;
    await sql.end();
  });

  it('rejects system_roles with role = "superuser"', async () => {
    await expect(
      db.insert(schema.systemRoles).values({
        userId: 'user-db-017-invalid',
        role: 'superuser',
      }),
    ).rejects.toThrow();
  });

  it('accepts system_roles with role = "admin"', async () => {
    const inserted = await db
      .insert(schema.systemRoles)
      .values({ userId: 'user-db-017-admin', role: 'admin' })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.role).toBe('admin');
  });

  it('accepts system_roles with role = "applicant"', async () => {
    const inserted = await db
      .insert(schema.systemRoles)
      .values({ userId: 'user-db-017-applicant', role: 'applicant' })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.role).toBe('applicant');
  });
});

describe.skipIf(!DATABASE_URL_TEST)('DB-017: mentor_grants CHECK integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql`DELETE FROM mentor_grants WHERE id LIKE 'grant-db-017%'`;
    await sql.end();
  });

  it('rejects mentor_grants with status = "pending"', async () => {
    await expect(
      db.insert(schema.mentorGrants).values({
        id: 'grant-db-017-invalid',
        applicantUserId: 'user-db-017-applicant',
        mentorUserId: 'user-db-017-mentor',
        grantedByUserId: 'user-db-017-admin',
        status: 'pending',
      }),
    ).rejects.toThrow();
  });

  it('accepts mentor_grants with status = "active"', async () => {
    const inserted = await db
      .insert(schema.mentorGrants)
      .values({
        id: 'grant-db-017-active',
        applicantUserId: 'user-db-017-applicant',
        mentorUserId: 'user-db-017-mentor',
        grantedByUserId: 'user-db-017-admin',
        status: 'active',
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.status).toBe('active');
  });

  it('accepts mentor_grants with status = "revoked"', async () => {
    const inserted = await db
      .insert(schema.mentorGrants)
      .values({
        id: 'grant-db-017-revoked',
        applicantUserId: 'user-db-017-applicant',
        mentorUserId: 'user-db-017-mentor',
        grantedByUserId: 'user-db-017-admin',
        status: 'revoked',
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.status).toBe('revoked');
  });
});
