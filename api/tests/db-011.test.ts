/**
 * DB-011 test: experiences contact columns (nullable PII) + E.164 phone CHECK.
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

describe('DB-011: experiences contact columns (unit)', () => {
  it('experiences table has contactTitle column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('contactTitle');
  });

  it('experiences table has contactFirstName column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('contactFirstName');
  });

  it('experiences table has contactLastName column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('contactLastName');
  });

  it('experiences table has contactEmail column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('contactEmail');
  });

  it('experiences table has contactPhone column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('contactPhone');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-011: experiences contact columns integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  let categoryId: string;

  const baseValues = {
    ownerUserId: 'user-db-011',
    organization: 'DB-011 Org',
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
      .values({ slug: 'db-011-test', name: 'DB-011 Test Category' })
      .returning();
    categoryId = cats[0]!.id;
  });

  afterAll(async () => {
    await db
      .delete(schema.experienceCategories)
      .where(eq(schema.experienceCategories.id, categoryId));
    await sql.end();
  });

  it('rejects contact_phone not in E.164 format', async () => {
    await expect(
      db.insert(schema.experiences).values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-011-bad-phone',
        contactPhone: '5551234',
      }),
    ).rejects.toThrow();
  });

  it('accepts a valid E.164 contact_phone', async () => {
    const inserted = await db
      .insert(schema.experiences)
      .values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-011-good-phone',
        contactPhone: '+14155550123',
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.contactPhone).toBe('+14155550123');

    await db.delete(schema.experiences).where(eq(schema.experiences.id, inserted[0]!.id));
  });

  it('inserts successfully with all contact fields NULL', async () => {
    const inserted = await db
      .insert(schema.experiences)
      .values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-011-null-contact',
        // all contact fields intentionally omitted — should default to NULL
      })
      .returning();

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.contactTitle).toBeNull();
    expect(row.contactFirstName).toBeNull();
    expect(row.contactLastName).toBeNull();
    expect(row.contactEmail).toBeNull();
    expect(row.contactPhone).toBeNull();

    await db.delete(schema.experiences).where(eq(schema.experiences.id, row.id));
  });
});
