/**
 * TEST-054 — Milestone award idempotency integration test.
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST +
 * applied migrations). Modelled on api-007.integration.test.ts.
 *
 * Ensures:
 *  1. First call to awardMilestones(userId) returns a non-empty list of newly-
 *     awarded keys when the user has earned ≥1 milestone (first-experience).
 *  2. SELECT count(*) FROM milestone_award WHERE user_id = … equals the number
 *     of earned milestones returned by the first call.
 *  3. Second call to awardMilestones(userId) for the unchanged user returns []
 *     (idempotent — the unique key held, ON CONFLICT DO NOTHING fired).
 *  4. The row count is unchanged after the second call.
 *
 * Cleanup: all inserted milestone_award + experiences + experience_categories
 * rows are deleted in a finally block (experiences before categories per FK).
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  experiences,
  experienceCategories,
  milestoneAward,
} from '../src/db/schema/index.js';
import { users } from '../src/db/schema/auth.js';
import { eq, count, inArray } from 'drizzle-orm';
import { awardMilestones } from '../src/services/milestones.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUpAndGetSession(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'T054 User', email, password: 'Password123!' }),
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function getUserId(email: string): Promise<string> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!rows.length) throw new Error(`User not found: ${email}`);
  return rows[0].id;
}

async function getMilestoneAwardCount(userId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(milestoneAward)
    .where(eq(milestoneAward.userId, userId));
  return Number(value);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TEST-054 — awardMilestones idempotency (live DB)', () => {
  it('first call awards milestones; second call is a no-op (unique key + ON CONFLICT DO NOTHING)', async () => {
    const app = await buildApp();
    const ts = Date.now();
    const email = `t054-idempotent+${ts}@example.com`;
    const expIds: string[] = [];
    const catIds: string[] = [];
    let userId = '';

    try {
      await signUpAndGetSession(app, email);
      userId = await getUserId(email);

      // Seed a category (no goal_hours — we only need the first-experience milestone).
      const [category] = await db
        .insert(experienceCategories)
        .values({
          slug: `t054-cat-${ts}`,
          name: 'T054 Category',
          sortOrder: 99,
          isActive: true,
        })
        .returning();
      catIds.push(category.id);

      // Seed one experience so the user earns the 'first-experience' milestone.
      const [exp] = await db
        .insert(experiences)
        .values({
          ownerUserId: userId,
          categoryId: category.id,
          organization: 'T054 Org',
          position: 'T054 Role',
          startDate: new Date('2024-01-01'),
          dutiesNarrative: 'Integration test experience for TEST-054.',
          totalHours: 10,
          hoursPerWeek: 2,
          numberOfWeeks: 5,
        })
        .returning();
      expIds.push(exp.id);

      // -----------------------------------------------------------------------
      // First call — should insert ≥1 row and return the newly-awarded keys.
      // -----------------------------------------------------------------------
      const firstRun = await awardMilestones(userId);

      expect(firstRun.length).toBeGreaterThan(0);
      expect(firstRun).toContain('first-experience');

      const countAfterFirst = await getMilestoneAwardCount(userId);
      expect(countAfterFirst).toBe(firstRun.length);

      // -----------------------------------------------------------------------
      // Second call (unchanged user) — must be a no-op.
      // -----------------------------------------------------------------------
      const secondRun = await awardMilestones(userId);

      expect(secondRun).toEqual([]);

      const countAfterSecond = await getMilestoneAwardCount(userId);
      expect(countAfterSecond).toBe(countAfterFirst); // row count unchanged
    } finally {
      // Clean up milestone_award rows first (no FK constraint to other test data).
      if (userId) await db.delete(milestoneAward).where(eq(milestoneAward.userId, userId));
      // Experiences before categories (FK constraint).
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});
