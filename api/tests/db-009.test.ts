/**
 * DB-009 test: experiences location columns and CHECK constraints.
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

describe('DB-009: experiences location columns (unit)', () => {
  it('experiences table has stateProvince column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('stateProvince');
  });

  it('experiences table has stateProvinceCode column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('stateProvinceCode');
  });

  it('experiences table has country column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('country');
  });

  it('experiences table has countryIso2 column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('countryIso2');
  });

  it('experiences table has countryIso3 column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('countryIso3');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-009: experiences location integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  let categoryId: string;

  const baseValues = {
    ownerUserId: 'user-db-009',
    organization: 'DB-009 Org',
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
      .values({ slug: 'db-009-test', name: 'DB-009 Test Category' })
      .returning();
    categoryId = cats[0]!.id;
  });

  afterAll(async () => {
    await db
      .delete(schema.experienceCategories)
      .where(eq(schema.experienceCategories.id, categoryId));
    await sql.end();
  });

  it('rejects country_iso2 of length != 2 (e.g. "USA")', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-009-iso2-bad',
        countryIso2: 'USA', // 3 chars — violates exact-length=2 CHECK
      }),
    ).rejects.toThrow();
  });

  it('rejects state_province_code longer than 8 characters', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-009-spcode-bad',
        stateProvinceCode: 'TOOLONGCD', // 9 chars — violates <= 8 CHECK
      }),
    ).rejects.toThrow();
  });

  it('accepts a row with all location columns NULL', async () => {
    const inserted = await db
      .insert(schema.experiences)
      .values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-009-null-loc',
        // all location columns omitted — default NULL
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.stateProvince).toBeNull();
    expect(inserted[0]?.stateProvinceCode).toBeNull();
    expect(inserted[0]?.country).toBeNull();
    expect(inserted[0]?.countryIso2).toBeNull();
    expect(inserted[0]?.countryIso3).toBeNull();

    await db.delete(schema.experiences).where(eq(schema.experiences.id, inserted[0]!.id));
  });
});
