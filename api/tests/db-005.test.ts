/**
 * DB-005 test: experience_categories table schema and integration.
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

describe('DB-005: experienceCategories schema shape (unit)', () => {
  it('experienceCategories table is exported from the schema barrel', () => {
    expect(schema.experienceCategories).toBeDefined();
  });

  it('experienceCategories table has the required columns', () => {
    const cols = Object.keys(schema.experienceCategories);
    expect(cols).toContain('id');
    expect(cols).toContain('slug');
    expect(cols).toContain('name');
    expect(cols).toContain('sortOrder');
    expect(cols).toContain('isActive');
    expect(cols).toContain('createdAt');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-005: experience_categories integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL_TEST!);
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('experience_categories table exists and can be queried', async () => {
    const rows = await db.select().from(schema.experienceCategories).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('rejects a slug that does not match the slug-format CHECK (Bad Slug)', async () => {
    await expect(
      db.insert(schema.experienceCategories).values({
        slug: 'Bad Slug',
        name: 'Test Category',
      }),
    ).rejects.toThrow();
  });

  it('rejects a name exceeding 128 characters', async () => {
    await expect(
      db.insert(schema.experienceCategories).values({
        slug: 'valid-slug',
        name: 'a'.repeat(129),
      }),
    ).rejects.toThrow();
  });

  it('accepts a valid slug and name, then cleans up', async () => {
    const inserted = await db
      .insert(schema.experienceCategories)
      .values({ slug: 'test-category', name: 'Test Category' })
      .returning();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.slug).toBe('test-category');
    expect(inserted[0]?.isActive).toBe(true);
    expect(inserted[0]?.sortOrder).toBe(0);
    // Clean up
    await db
      .delete(schema.experienceCategories)
      .where(eq(schema.experienceCategories.id, inserted[0]!.id));
  });
});
