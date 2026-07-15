/**
 * DB-010 test: experiences attestation boolean columns.
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

describe('DB-010: experiences attestation boolean columns (unit)', () => {
  it('experiences table has isCurrent column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('isCurrent');
  });

  it('experiences table has receivedAcademicCredit column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('receivedAcademicCredit');
  });

  it('experiences table has receivedSalaryOrPayment column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('receivedSalaryOrPayment');
  });

  it('experiences table has isVolunteer column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('isVolunteer');
  });

  it('experiences table has isMostImportant column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('isMostImportant');
  });

  it('experiences table has permissionToContact column', () => {
    const cols = Object.keys(schema.experiences);
    expect(cols).toContain('permissionToContact');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-010: experiences attestation booleans integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  let categoryId: string;

  const baseValues = {
    ownerUserId: 'user-db-010',
    organization: 'DB-010 Org',
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
      .values({ slug: 'db-010-test', name: 'DB-010 Test Category' })
      .returning();
    categoryId = cats[0]!.id;
  });

  afterAll(async () => {
    await db
      .delete(schema.experienceCategories)
      .where(eq(schema.experienceCategories.id, categoryId));
    await sql.end();
  });

  it('inserting an experience without specifying attestation booleans yields all six false', async () => {
    const inserted = await db
      .insert(schema.experiences)
      .values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-010-defaults',
        // attestation booleans intentionally omitted — should default to false
      })
      .returning();

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.isCurrent).toBe(false);
    expect(row.receivedAcademicCredit).toBe(false);
    expect(row.receivedSalaryOrPayment).toBe(false);
    expect(row.isVolunteer).toBe(false);
    expect(row.isMostImportant).toBe(false);
    expect(row.permissionToContact).toBe(false);

    await db.delete(schema.experiences).where(eq(schema.experiences.id, row.id));
  });

  it('permissionToContact defaults to false (opt-in consent)', async () => {
    const inserted = await db
      .insert(schema.experiences)
      .values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-010-ptc',
      })
      .returning();

    const row = inserted[0]!;
    expect(row.permissionToContact).toBe(false);

    await db.delete(schema.experiences).where(eq(schema.experiences.id, row.id));
  });

  it('can explicitly set attestation booleans to true', async () => {
    const inserted = await db
      .insert(schema.experiences)
      .values({
        ...baseValues,
        categoryId,
        ownerUserId: 'user-db-010-true',
        isCurrent: true,
        receivedAcademicCredit: true,
        receivedSalaryOrPayment: true,
        isVolunteer: true,
        isMostImportant: true,
        permissionToContact: true,
      })
      .returning();

    const row = inserted[0]!;
    expect(row.isCurrent).toBe(true);
    expect(row.receivedAcademicCredit).toBe(true);
    expect(row.receivedSalaryOrPayment).toBe(true);
    expect(row.isVolunteer).toBe(true);
    expect(row.isMostImportant).toBe(true);
    expect(row.permissionToContact).toBe(true);

    await db.delete(schema.experiences).where(eq(schema.experiences.id, row.id));
  });
});
