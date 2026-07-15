/**
 * DB-027 test: milestone_award schema shape (unit; no DB connection).
 *
 * Introspects the Drizzle table object and the generated migration SQL:
 *   - table name is 'milestone_award'
 *   - all four columns are present
 *   - nullability / default flags match the spec
 *   - a migration SQL declares the table, the unique constraint,
 *     both CHECKs (user_id_len, key_len), and the user index
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { milestoneAward } from '../src/db/schema/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DB-027: milestone_award schema (unit)', () => {
  it('table name is milestone_award', () => {
    expect(getTableName(milestoneAward)).toBe('milestone_award');
  });

  it('has all four expected columns', () => {
    const columns = getTableColumns(milestoneAward);
    const names = Object.values(columns).map((c) => c.name);
    for (const col of ['id', 'user_id', 'milestone_key', 'earned_at']) {
      expect(names, `column ${col} missing`).toContain(col);
    }
  });

  it('nullability and default flags match the spec', () => {
    const c = getTableColumns(milestoneAward);
    expect(c.id.notNull).toBe(true);
    expect(c.id.hasDefault).toBe(true);
    expect(c.userId.notNull).toBe(true);
    expect(c.milestoneKey.notNull).toBe(true);
    expect(c.earnedAt.notNull).toBe(true);
    expect(c.earnedAt.hasDefault).toBe(true);
  });

  it('a migration SQL declares the table, unique constraint, both CHECKs, and index', () => {
    const journal = JSON.parse(
      readFileSync(path.join(__dirname, '../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };
    const allSql = journal.entries
      .map((e) =>
        readFileSync(path.join(__dirname, `../drizzle/${e.tag}.sql`), 'utf8'),
      )
      .join('\n');
    expect(allSql).toContain('milestone_award');
    expect(allSql).toContain('milestone_award_user_key_uq');
    expect(allSql).toContain('milestone_award_user_id_len');
    expect(allSql).toContain('milestone_award_key_len');
    expect(allSql).toContain('milestone_award_user_idx');
  });
});
