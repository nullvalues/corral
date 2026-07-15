/**
 * DB-033 integration test: flag_report table.
 *
 * Requires a live PostgreSQL test database (DATABASE_URL_TEST); migrations
 * are applied by tests/globalSetup.ts before this file loads.
 *
 * Covers (DB-033 Tests):
 * - A flag_report row inserts and round-trips with default status = 'open'
 *   and a generated id.
 * - A status value outside ('open','resolved') fails with a check-violation.
 * - A reason longer than 1024 characters fails with a check-violation.
 */

import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { flagReport } from '../src/db/schema/index.js';

const REVIEWER = 'test-reviewer-db033';

/**
 * Runs an insert expected to violate a CHECK constraint and asserts the
 * rejection names that constraint. Drizzle wraps the Postgres error, putting
 * the constraint detail on `error.cause`, so we inspect both levels.
 */
async function expectCheckViolation(
  promise: Promise<unknown>,
  constraintName: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, 'insert should have been rejected').toBeInstanceOf(Error);
  const e = caught as Error & { cause?: unknown };
  const text = `${e.message} ${String(e.cause ?? '')}`;
  expect(text).toMatch(constraintName);
}

describe('DB-033: flag_report table (integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeAll(async () => {
    const mod = await import('../src/db/index.js');
    db = mod.db;
    await db.delete(flagReport).where(eq(flagReport.reviewerUserId, REVIEWER));
  });

  afterAll(async () => {
    await db.delete(flagReport).where(eq(flagReport.reviewerUserId, REVIEWER));
  });

  it('inserts and round-trips with default status = open and a generated id', async () => {
    const [row] = await db
      .insert(flagReport)
      .values({
        reviewerUserId: REVIEWER,
        experienceId: '00000000-0000-4000-8000-0000000db033',
        reason: 'Hours claimed exceed the plausible weekly maximum.',
      })
      .returning();

    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(row.status).toBe('open');
    expect(row.resolvedByUserId).toBeNull();
    expect(row.resolvedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);

    const [fetched] = await db
      .select()
      .from(flagReport)
      .where(eq(flagReport.id, row.id));
    expect(fetched.reviewerUserId).toBe(REVIEWER);
    expect(fetched.reason).toBe('Hours claimed exceed the plausible weekly maximum.');
    expect(fetched.status).toBe('open');
  });

  it('rejects a status value outside (open, resolved) with a check violation', async () => {
    await expectCheckViolation(
      db.insert(flagReport).values({
        reviewerUserId: REVIEWER,
        experienceId: '00000000-0000-4000-8000-0000000db033',
        reason: 'bad status attempt',
        status: 'escalated',
      }),
      'flag_report_status_values',
    );
  });

  it('rejects a reason longer than 1024 characters with a check violation', async () => {
    await expectCheckViolation(
      db.insert(flagReport).values({
        reviewerUserId: REVIEWER,
        experienceId: '00000000-0000-4000-8000-0000000db033',
        reason: 'x'.repeat(1025),
      }),
      'flag_report_reason_len',
    );
  });
});
