/**
 * DB-012 test: text-length CHECK sweep for experiences table.
 *
 * Unit tests run always (no DB required).
 * Integration tests are skipped when DATABASE_URL_TEST is not set.
 *
 * Integration tests verify:
 *   - duties_narrative > 8192 chars is rejected
 *   - organization > 256 chars is rejected
 *   - Completeness audit: every text column in experience_categories and experiences
 *     has at least one CHECK constraint referencing it in pg_constraint.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema/index.js';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

// --- Unit tests (no DB) ---

describe('DB-012: text-length CHECKs (unit)', () => {
  it('experiences table has contactTitle column', () => {
    expect(Object.keys(schema.experiences)).toContain('contactTitle');
  });

  it('experiences table has organization column', () => {
    expect(Object.keys(schema.experiences)).toContain('organization');
  });

  it('experiences table has dutiesNarrative column', () => {
    expect(Object.keys(schema.experiences)).toContain('dutiesNarrative');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-012: text-length CHECK integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let categoryId: string;

  const baseValues = {
    ownerUserId: 'user-db-012',
    organization: 'DB-012 Org',
    position: 'Tester',
    startDate: new Date('2024-01-01'),
    dutiesNarrative: 'Test duties.',
    totalHours: 40,
    hoursPerWeek: 8,
    numberOfWeeks: 5,
  } as const;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });

    const cats = await db
      .insert(schema.experienceCategories)
      .values({ slug: 'db-012-test', name: 'DB-012 Test Category' })
      .returning();
    categoryId = cats[0]!.id;
  });

  afterAll(async () => {
    // Clean up any leftover experiences rows first, then the category.
    await sql`DELETE FROM experiences WHERE owner_user_id LIKE 'user-db-012%'`;
    await sql`DELETE FROM experience_categories WHERE slug = 'db-012-test'`;
    await sql.end();
  });

  it('rejects duties_narrative longer than 8192 characters', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-012-narrative-overflow',
        dutiesNarrative: 'x'.repeat(8193),
      }),
    ).rejects.toThrow();
  });

  it('rejects organization longer than 256 characters', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-012-org-overflow',
        organization: 'A'.repeat(257),
      }),
    ).rejects.toThrow();
  });

  it('rejects position longer than 256 characters', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-012-pos-overflow',
        position: 'B'.repeat(257),
      }),
    ).rejects.toThrow();
  });

  it('rejects contact_title longer than 128 characters', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-012-ctitle-overflow',
        contactTitle: 'C'.repeat(129),
      }),
    ).rejects.toThrow();
  });

  it('rejects contact_first_name longer than 128 characters', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-012-cfn-overflow',
        contactFirstName: 'D'.repeat(129),
      }),
    ).rejects.toThrow();
  });

  it('rejects contact_last_name longer than 128 characters', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-012-cln-overflow',
        contactLastName: 'E'.repeat(129),
      }),
    ).rejects.toThrow();
  });

  it('rejects contact_email longer than 320 characters', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-012-cemail-overflow',
        contactEmail: 'F'.repeat(321),
      }),
    ).rejects.toThrow();
  });

  it('accepts row at max bounds (org=256, position=256, narrative=8192)', async () => {
    const inserted = await db
      .insert(schema.experiences)
      .values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-012-max-bounds',
        organization: 'O'.repeat(256),
        position: 'P'.repeat(256),
        dutiesNarrative: 'N'.repeat(8192),
      })
      .returning();

    expect(inserted).toHaveLength(1);
    await sql`DELETE FROM experiences WHERE id = ${inserted[0]!.id}`;
  });

  /**
   * Completeness audit: every text column in experience_categories and experiences
   * must have at least one CHECK constraint referencing it.
   *
   * Columns excluded from check-constraint requirement:
   *   - experience_categories.id      (uuid PK, not a text column to constrain)
   *   - experiences.id                (uuid PK)
   *   - experiences.owner_user_id     (app reference, not end-user text input)
   *   - experiences.category_id       (FK uuid, not a text column)
   *   - experiences.frequency         (enum, not text)
   *
   * All user-supplied text columns must have a CHECK.
   */
  it('completeness audit: all text columns in experience_categories have a CHECK', async () => {
    // Get all text columns in experience_categories
    const textCols = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'experience_categories'
        AND data_type = 'text'
      ORDER BY column_name
    `;

    // Get all CHECK constraints on experience_categories (search_condition contains column name)
    const checks = await sql<{ consrc: string }[]>`
      SELECT pg_get_constraintdef(c.oid) AS consrc
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'experience_categories'
        AND c.contype = 'c'
    `;
    const checkSrc = checks.map((r) => r.consrc);

    // Columns that are legitimately not user-supplied text:
    const excluded = new Set<string>(['id']);

    for (const { column_name } of textCols) {
      if (excluded.has(column_name)) continue;
      const covered = checkSrc.some((src) => src.includes(column_name));
      expect(covered, `experience_categories.${column_name} has no CHECK constraint`).toBe(true);
    }
  });

  it('completeness audit: all text columns in experiences have a CHECK', async () => {
    // Get all text columns in experiences
    const textCols = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'experiences'
        AND data_type = 'text'
      ORDER BY column_name
    `;

    // Get all CHECK constraints on experiences
    const checks = await sql<{ consrc: string }[]>`
      SELECT pg_get_constraintdef(c.oid) AS consrc
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'experiences'
        AND c.contype = 'c'
    `;
    const checkSrc = checks.map((r) => r.consrc);

    // Columns that are legitimately excluded from length CHECK requirements:
    //   owner_user_id — app-level reference (text PK from BA), not end-user input
    const excluded = new Set<string>(['owner_user_id']);

    for (const { column_name } of textCols) {
      if (excluded.has(column_name)) continue;
      const covered = checkSrc.some((src) => src.includes(column_name));
      expect(covered, `experiences.${column_name} has no CHECK constraint`).toBe(true);
    }
  });
});
