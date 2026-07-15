/**
 * DB-028 test: user_profiles schema shape (unit; no DB connection).
 *
 * Introspects the Drizzle table object and the generated migration SQL:
 *   - table name is 'user_profiles'
 *   - all five columns are present
 *   - nullability / default flags match the spec
 *   - the migration SQL declares the table and all three CHECK constraints
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { userProfiles } from '../src/db/schema/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DB-028: user_profiles schema (unit)', () => {
  it('table name is user_profiles', () => {
    expect(getTableName(userProfiles)).toBe('user_profiles');
  });

  it('has all five expected columns', () => {
    const columns = getTableColumns(userProfiles);
    const names = Object.values(columns).map((c) => c.name);
    for (const col of ['user_id', 'school', 'graduation_year', 'bio', 'updated_at']) {
      expect(names, `column ${col} missing`).toContain(col);
    }
  });

  it('nullability and default flags match the spec', () => {
    const c = getTableColumns(userProfiles);
    // user_id is PK — notNull
    expect(c.userId.notNull).toBe(true);
    // optional fields are nullable
    expect(c.school.notNull).toBe(false);
    expect(c.graduationYear.notNull).toBe(false);
    expect(c.bio.notNull).toBe(false);
    // updated_at is NOT NULL with a default
    expect(c.updatedAt.notNull).toBe(true);
    expect(c.updatedAt.hasDefault).toBe(true);
  });

  it('migration 0024_user_profiles.sql exists in the journal', () => {
    const journal = JSON.parse(
      readFileSync(path.join(__dirname, '../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };

    // The file must be present at the expected path
    const migrationPath = path.join(__dirname, '../drizzle/0024_user_profiles.sql');
    const migrationSql = readFileSync(migrationPath, 'utf8');
    expect(migrationSql).toBeTruthy();

    // The entry must be present in the journal
    const found = journal.entries.some((e) => e.tag === '0024_user_profiles');
    expect(found).toBe(true);
  });

  it('migration SQL declares table and all three CHECK constraints', () => {
    const migrationSql = readFileSync(
      path.join(__dirname, '../drizzle/0024_user_profiles.sql'),
      'utf8',
    );
    expect(migrationSql).toContain('"user_profiles"');
    expect(migrationSql).toContain('user_profiles_school_len');
    expect(migrationSql).toContain('user_profiles_grad_year_range');
    expect(migrationSql).toContain('user_profiles_bio_len');
  });
});
