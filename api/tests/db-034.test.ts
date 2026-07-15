/**
 * DB-034 test: user_profiles headshot_key and resume_key columns.
 *
 * Unit tests verify the two new columns are present in the Drizzle schema.
 * Integration tests (require DATABASE_URL_TEST) verify:
 *   - Migration applies cleanly and both columns accept NULL.
 *   - Both columns accept a normal S3 object key value.
 *   - A headshot_key value longer than 512 characters is rejected by the DB CHECK.
 *   - A resume_key value longer than 512 characters is rejected by the DB CHECK.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema/index.js';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

// --- Unit tests (no DB) ---

describe('DB-034: user_profiles schema columns (unit)', () => {
  it('userProfiles table has headshotKey column', () => {
    expect(Object.keys(schema.userProfiles)).toContain('headshotKey');
  });

  it('userProfiles table has resumeKey column', () => {
    expect(Object.keys(schema.userProfiles)).toContain('resumeKey');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-034: user_profiles headshot/resume key CHECK constraints (integration)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const testUserId = 'db-034-test-user';

  beforeAll(async () => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });
    await sql`DELETE FROM user_profiles WHERE user_id = ${testUserId}`;
  });

  afterAll(async () => {
    await sql`DELETE FROM user_profiles WHERE user_id = ${testUserId}`;
    await sql.end();
  });

  it('accepts NULL for both new columns', async () => {
    const inserted = await db
      .insert(schema.userProfiles)
      .values({
        userId:      testUserId,
        headshotKey: null,
        resumeKey:   null,
      })
      .returning();

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.headshotKey).toBeNull();
    expect(row.resumeKey).toBeNull();

    await sql`DELETE FROM user_profiles WHERE user_id = ${testUserId}`;
  });

  it('round-trips a normal S3 key value for both columns', async () => {
    const headshot = 'headshots/user-abc123.jpg';
    const resume   = 'resumes/user-abc123.pdf';

    const inserted = await db
      .insert(schema.userProfiles)
      .values({
        userId:      testUserId,
        headshotKey: headshot,
        resumeKey:   resume,
      })
      .returning();

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.headshotKey).toBe(headshot);
    expect(row.resumeKey).toBe(resume);

    await sql`DELETE FROM user_profiles WHERE user_id = ${testUserId}`;
  });

  it('rejects a headshot_key longer than 512 characters', async () => {
    await expect(
      db.insert(schema.userProfiles).values({
        userId:      testUserId,
        headshotKey: 'h'.repeat(513),
      }),
    ).rejects.toThrow();
  });

  it('rejects a resume_key longer than 512 characters', async () => {
    await expect(
      db.insert(schema.userProfiles).values({
        userId:    testUserId,
        resumeKey: 'r'.repeat(513),
      }),
    ).rejects.toThrow();
  });
});
