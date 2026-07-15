/**
 * DB-032 test: user_profiles schema expansion.
 *
 * Unit tests verify the five new columns are present in the Drizzle schema.
 * Integration tests (require DATABASE_URL_TEST) verify:
 *   - All five new columns round-trip successfully.
 *   - A phone value not matching E.164 is rejected by the DB CHECK.
 *   - A major value longer than 128 characters is rejected by the DB CHECK.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema/index.js';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

// --- Unit tests (no DB) ---

describe('DB-032: user_profiles schema columns (unit)', () => {
  it('userProfiles table has major column', () => {
    expect(Object.keys(schema.userProfiles)).toContain('major');
  });

  it('userProfiles table has gpa column', () => {
    expect(Object.keys(schema.userProfiles)).toContain('gpa');
  });

  it('userProfiles table has phone column', () => {
    expect(Object.keys(schema.userProfiles)).toContain('phone');
  });

  it('userProfiles table has linkedinUrl column', () => {
    expect(Object.keys(schema.userProfiles)).toContain('linkedinUrl');
  });

  it('userProfiles table has portfolioUrl column', () => {
    expect(Object.keys(schema.userProfiles)).toContain('portfolioUrl');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-032: user_profiles CHECK constraints (integration)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const testUserId = 'db-032-test-user';

  beforeAll(async () => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });
    // Clean up any stale row from a previous run before starting.
    await sql`DELETE FROM user_profiles WHERE user_id = ${testUserId}`;
  });

  afterAll(async () => {
    await sql`DELETE FROM user_profiles WHERE user_id = ${testUserId}`;
    await sql.end();
  });

  it('round-trips all five new columns successfully', async () => {
    const inserted = await db
      .insert(schema.userProfiles)
      .values({
        userId:       testUserId,
        major:        'Computer Science',
        gpa:          '3.85',
        phone:        '+15555550101',
        linkedinUrl:  'https://linkedin.com/in/test',
        portfolioUrl: 'https://example.com/portfolio',
      })
      .returning();

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.major).toBe('Computer Science');
    expect(row.gpa).toBe('3.85');
    expect(row.phone).toBe('+15555550101');
    expect(row.linkedinUrl).toBe('https://linkedin.com/in/test');
    expect(row.portfolioUrl).toBe('https://example.com/portfolio');

    // Clean up the inserted row so subsequent tests start fresh.
    await sql`DELETE FROM user_profiles WHERE user_id = ${testUserId}`;
  });

  it('rejects a phone not matching E.164 format', async () => {
    await expect(
      db.insert(schema.userProfiles).values({
        userId: testUserId,
        phone:  '555-1234',
      }),
    ).rejects.toThrow();
  });

  it('rejects a major longer than 128 characters', async () => {
    await expect(
      db.insert(schema.userProfiles).values({
        userId: testUserId,
        major:  'M'.repeat(129),
      }),
    ).rejects.toThrow();
  });

  it('accepts null for all five new columns', async () => {
    const inserted = await db
      .insert(schema.userProfiles)
      .values({
        userId:       testUserId,
        major:        null,
        gpa:          null,
        phone:        null,
        linkedinUrl:  null,
        portfolioUrl: null,
      })
      .returning();

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.major).toBeNull();
    expect(row.gpa).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.linkedinUrl).toBeNull();
    expect(row.portfolioUrl).toBeNull();

    await sql`DELETE FROM user_profiles WHERE user_id = ${testUserId}`;
  });
});
