/**
 * DB-008 test: experiences hours triple columns and CHECK constraints.
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

describe('DB-008: experiences hours triple columns (unit)', () => {
  it('experiences table has totalHours column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('totalHours');
  });

  it('experiences table has hoursPerWeek column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('hoursPerWeek');
  });

  it('experiences table has numberOfWeeks column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('numberOfWeeks');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-008: experiences hours triple integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  let categoryId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });

    const cats = await db
      .insert(schema.experienceCategories)
      .values({ slug: 'db-008-test', name: 'DB-008 Test Category' })
      .returning();
    categoryId = cats[0]!.id;
  });

  afterAll(async () => {
    await db
      .delete(schema.experienceCategories)
      .where(eq(schema.experienceCategories.id, categoryId));
    await sql.end();
  });

  it('rejects insert when total_hours != hours_per_week * number_of_weeks (triple mismatch)', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ownerUserId: 'user-db-008-mismatch',
        categoryId,
        organization: 'Mismatch Org',
        position: 'Tester',
        startDate: new Date('2024-01-01'),
        dutiesNarrative: 'Test duties.',
        // 41 != 8 * 5 = 40
        totalHours: 41,
        hoursPerWeek: 8,
        numberOfWeeks: 5,
      }),
    ).rejects.toThrow();
  });

  it('rejects insert when total_hours exceeds 100000', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ownerUserId: 'user-db-008-overflow',
        categoryId,
        organization: 'Overflow Org',
        position: 'Tester',
        startDate: new Date('2024-01-01'),
        dutiesNarrative: 'Test duties.',
        // 100001 = 1 * 100001 — satisfies triple but violates bounds
        totalHours: 100001,
        hoursPerWeek: 1,
        numberOfWeeks: 100001,
      }),
    ).rejects.toThrow();
  });

  it('rejects insert when hours_per_week exceeds 168', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ownerUserId: 'user-db-008-hpw',
        categoryId,
        organization: 'HPW Org',
        position: 'Tester',
        startDate: new Date('2024-01-01'),
        dutiesNarrative: 'Test duties.',
        // 200 * 1 = 200, triple satisfied but hpw > 168
        totalHours: 200,
        hoursPerWeek: 200,
        numberOfWeeks: 1,
      }),
    ).rejects.toThrow();
  });

  it('accepts a valid hours triple and then cleans up', async () => {
    const inserted = await db
      .insert(schema.experiences)
      .values({
        ownerUserId: 'user-db-008-valid',
        categoryId,
        organization: 'Valid Org',
        position: 'Valid Position',
        startDate: new Date('2023-06-01'),
        dutiesNarrative: 'Performed various duties.',
        // 40 = 8 * 5 — valid triple
        totalHours: 40,
        hoursPerWeek: 8,
        numberOfWeeks: 5,
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.totalHours).toBe(40);
    expect(inserted[0]?.hoursPerWeek).toBe(8);
    expect(inserted[0]?.numberOfWeeks).toBe(5);

    await db.delete(schema.experiences).where(eq(schema.experiences.id, inserted[0]!.id));
  });
});
