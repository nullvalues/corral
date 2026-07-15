/**
 * DB-028 integration test: user_profiles DB constraint verification.
 *
 * Requires a live PostgreSQL test database (DATABASE_URL_TEST).
 * Tests all CHECK constraints, PK behaviour, and UPSERT semantics.
 */

import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('DB-028: user_profiles constraints (integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeAll(async () => {
    const mod = await import('../src/db/index.js');
    db = mod.db;
    // Clean up any leftover rows from previous runs
    await db.execute(sql`DELETE FROM user_profiles WHERE user_id LIKE 'db028-%'`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM user_profiles WHERE user_id LIKE 'db028-%'`);
  });

  it('INSERT with all fields populated succeeds', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO user_profiles (user_id, school, graduation_year, bio, updated_at)
        VALUES ('db028-all', 'State University', 2024, 'Short bio.', now())
      `),
    ).resolves.toBeDefined();
  });

  it('INSERT with school longer than 256 chars is rejected', async () => {
    const longSchool = 'x'.repeat(257);
    await expect(
      db.execute(sql`
        INSERT INTO user_profiles (user_id, school)
        VALUES ('db028-long-school', ${longSchool})
      `),
    ).rejects.toThrow();
  });

  it('INSERT with graduation_year = 1999 is rejected', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO user_profiles (user_id, graduation_year)
        VALUES ('db028-yr-1999', 1999)
      `),
    ).rejects.toThrow();
  });

  it('INSERT with graduation_year = 2000 is accepted', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO user_profiles (user_id, graduation_year)
        VALUES ('db028-yr-2000', 2000)
      `),
    ).resolves.toBeDefined();
  });

  it('INSERT with graduation_year = 2100 is accepted', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO user_profiles (user_id, graduation_year)
        VALUES ('db028-yr-2100', 2100)
      `),
    ).resolves.toBeDefined();
  });

  it('INSERT with graduation_year = 2101 is rejected', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO user_profiles (user_id, graduation_year)
        VALUES ('db028-yr-2101', 2101)
      `),
    ).rejects.toThrow();
  });

  it('INSERT with bio longer than 500 chars is rejected', async () => {
    const longBio = 'b'.repeat(501);
    await expect(
      db.execute(sql`
        INSERT INTO user_profiles (user_id, bio)
        VALUES ('db028-long-bio', ${longBio})
      `),
    ).rejects.toThrow();
  });

  it('second INSERT with same user_id (PK conflict) is rejected', async () => {
    // First insert (should succeed)
    await db.execute(sql`
      INSERT INTO user_profiles (user_id, school)
      VALUES ('db028-pk-conflict', 'School A')
    `);
    // Second insert with same user_id (should fail)
    await expect(
      db.execute(sql`
        INSERT INTO user_profiles (user_id, school)
        VALUES ('db028-pk-conflict', 'School B')
      `),
    ).rejects.toThrow();
  });

  it('UPSERT ON CONFLICT (user_id) DO UPDATE succeeds', async () => {
    await db.execute(sql`
      INSERT INTO user_profiles (user_id, school)
      VALUES ('db028-upsert', 'Original School')
    `);
    await expect(
      db.execute(sql`
        INSERT INTO user_profiles (user_id, school)
        VALUES ('db028-upsert', 'Updated School')
        ON CONFLICT (user_id) DO UPDATE SET school = EXCLUDED.school
      `),
    ).resolves.toBeDefined();

    // Verify the update took effect
    const rows = await db.execute(sql`
      SELECT school FROM user_profiles WHERE user_id = 'db028-upsert'
    `) as Array<{ school: string }>;
    expect(rows[0]?.school).toBe('Updated School');
  });
});
