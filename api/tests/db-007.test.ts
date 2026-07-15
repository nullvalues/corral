/**
 * DB-007 test: experiences table schema and integration.
 *
 * Unit tests run always (no DB required).
 * Integration tests are skipped when DATABASE_URL_TEST is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema/index.js';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

// --- Unit tests (no DB) ---

describe('DB-007: experiences schema shape (unit)', () => {
  it('experiences table is exported from the schema barrel', () => {
    expect(schema.experiences).toBeDefined();
  });

  it('experiences table has the required core columns', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('id');
    expect(cols).toContain('ownerUserId');
    expect(cols).toContain('categoryId');
    expect(cols).toContain('organization');
    expect(cols).toContain('position');
    expect(cols).toContain('frequency');
    expect(cols).toContain('startDate');
    expect(cols).toContain('endDate');
    expect(cols).toContain('dutiesNarrative');
    expect(cols).toContain('createdAt');
    expect(cols).toContain('updatedAt');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-007: experiences integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  // A valid category inserted once and cleaned up after the suite.
  let categoryId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });

    // Insert a throwaway category so the FK constraint is satisfiable.
    const cats = await db
      .insert(schema.experienceCategories)
      .values({ slug: 'db-007-test', name: 'DB-007 Test Category' })
      .returning();
    categoryId = cats[0]!.id;
  });

  afterAll(async () => {
    // Clean up the throwaway category (cascades not set, so experiences must be gone first).
    await db
      .delete(schema.experienceCategories)
      .where(eq(schema.experienceCategories.id, categoryId));
    await sql.end();
  });

  it('experiences table exists and can be queried', async () => {
    const rows = await db.select().from(schema.experiences).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('rejects an insert with a non-existent category_id (FK violation)', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ownerUserId: 'user-does-not-matter',
        categoryId: '00000000-0000-0000-0000-000000000000',
        organization: 'ACME',
        position: 'Tester',
        startDate: new Date('2024-01-01'),
        dutiesNarrative: 'Test duties.',
        totalHours: 40,
        hoursPerWeek: 8,
        numberOfWeeks: 5,
      }),
    ).rejects.toThrow();
  });

  it('accepts a valid experience insert and then cleans up', async () => {
    const inserted = await db
      .insert(schema.experiences)
      .values({
        ownerUserId: 'user-test-db-007',
        categoryId,
        organization: 'Test Org',
        position: 'Test Position',
        frequency: 'ongoing',
        startDate: new Date('2023-06-01'),
        endDate: new Date('2024-01-15'),
        dutiesNarrative: 'Performed various duties.',
        totalHours: 40,
        hoursPerWeek: 8,
        numberOfWeeks: 5,
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.organization).toBe('Test Org');
    expect(inserted[0]?.frequency).toBe('ongoing');
    expect(inserted[0]?.ownerUserId).toBe('user-test-db-007');

    // Clean up
    await db.delete(schema.experiences).where(eq(schema.experiences.id, inserted[0]!.id));
  });

  it('owner_user_id index exists in pg_indexes', async () => {
    const result = await sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'experiences'
        AND indexname = 'experiences_owner_idx'
    `;
    expect(result).toHaveLength(1);
  });

  it('category_id index exists in pg_indexes', async () => {
    const result = await sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'experiences'
        AND indexname = 'experiences_category_idx'
    `;
    expect(result).toHaveLength(1);
  });
});
