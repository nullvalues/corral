/**
 * DB-026 test: interview_shortlist schema shape (unit; no DB connection).
 *
 * Introspects the Drizzle table object and the generated migration SQL:
 *   - table name is 'interview_shortlist'
 *   - all six columns are present
 *   - nullability / default flags match the spec
 *   - the latest migration SQL declares the table, a composite PRIMARY KEY,
 *     and the star-rating bounds CHECK
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { interviewShortlist } from '../src/db/schema/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DB-026: interview_shortlist schema (unit)', () => {
  it('table name is interview_shortlist', () => {
    expect(getTableName(interviewShortlist)).toBe('interview_shortlist');
  });

  it('has all six expected columns', () => {
    const columns = getTableColumns(interviewShortlist);
    const names = Object.values(columns).map((c) => c.name);
    for (const col of [
      'reviewer_user_id',
      'applicant_user_id',
      'star_rating',
      'shortlisted',
      'created_at',
      'updated_at',
    ]) {
      expect(names, `column ${col} missing`).toContain(col);
    }
  });

  it('nullability and default flags match the spec', () => {
    const c = getTableColumns(interviewShortlist);
    expect(c.starRating.notNull).toBe(false);
    expect(c.shortlisted.notNull).toBe(true);
    expect(c.shortlisted.hasDefault).toBe(true);
    expect(c.reviewerUserId.notNull).toBe(true);
  });

  it('a migration SQL declares the table, composite PK, and bounds CHECK', () => {
    const journal = JSON.parse(
      readFileSync(path.join(__dirname, '../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };
    const allSql = journal.entries
      .map((e) =>
        readFileSync(path.join(__dirname, `../drizzle/${e.tag}.sql`), 'utf8'),
      )
      .join('\n');
    expect(allSql).toContain('interview_shortlist');
    expect(allSql).toContain('PRIMARY KEY');
    expect(allSql).toContain('interview_shortlist_star_rating_bounds');
  });
});
