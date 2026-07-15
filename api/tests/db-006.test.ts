/**
 * DB-006 test: frequency_of_experience Postgres enum schema and integration.
 *
 * Unit tests run always (no DB required).
 * Integration tests are skipped when DATABASE_URL_TEST is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import * as schema from '../src/db/schema/index.js';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

// --- Unit tests (no DB) ---

describe('DB-006: frequencyOfExperience schema shape (unit)', () => {
  it('frequencyOfExperience enum is exported from the schema barrel', () => {
    expect(schema.frequencyOfExperience).toBeDefined();
  });

  it('frequencyOfExperience enum has exactly three values', () => {
    const values = schema.frequencyOfExperience.enumValues;
    expect(values).toHaveLength(3);
    expect(values).toContain('temporary');
    expect(values).toContain('recurring');
    expect(values).toContain('ongoing');
  });
});

// --- Integration tests (require DATABASE_URL_TEST) ---

describe.skipIf(!DATABASE_URL_TEST)('DB-006: frequency_of_experience integration', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL_TEST!);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('enum type exists in the database with exactly temporary, recurring, ongoing', async () => {
    const result = await sql`SELECT enum_range(NULL::frequency_of_experience) AS values`;
    const row = result[0];
    expect(row).toBeDefined();
    // postgres-js parses Postgres arrays into JS arrays; normalise to a sorted
    // array of strings for a stable comparison regardless of driver version.
    const raw = row!['values'];
    const values: string[] = Array.isArray(raw)
      ? raw
      : String(raw)
          .replace(/^\{/, '')
          .replace(/\}$/, '')
          .split(',')
          .map((s: string) => s.trim());
    expect(values).toHaveLength(3);
    expect(values).toContain('temporary');
    expect(values).toContain('recurring');
    expect(values).toContain('ongoing');
  });
});
