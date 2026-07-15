/**
 * Unit tests for GET /api/me/milestones (API-046).
 *
 * Unit project — no DATABASE_URL_TEST required. The DB is mocked.
 *
 * Covers:
 *   - Route returns 401 when unauthenticated.
 *   - Route returns 200 with one entry per canonical key; earned keys have
 *     earned: true, non-null earnedAt, remainingLabel: null; locked keys have
 *     earned: false, earnedAt: null, non-null remainingLabel.
 *   - getMyMilestones reflects the STORED award set, not a predicate
 *     re-derivation: a user whose context satisfies a predicate but has no
 *     award row returns earned: false.
 *
 * DB select chain call order inside getMyMilestones:
 *   call 0 — experiences aggregate (getMilestoneContext step 1) → .where()
 *   call 1 — milestoneAward rows                                  → .where()
 *   call 2 — experienceCategories goal query (getMilestoneContext step 2) → .leftJoin().where().groupBy()
 *
 * Both calls 0 and 1 terminate at .where(). We use aggWhereMock with
 * mockReturnValueOnce to control each return value in sequence.
 * Call 2 terminates at .groupBy() via goalGroupByMock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock — same pattern as api-045.test.ts extended for milestoneAward query.
// ---------------------------------------------------------------------------

const { aggWhereMock, goalGroupByMock, hourOrderByMock } = vi.hoisted(() => ({
  aggWhereMock: vi.fn(),
  goalGroupByMock: vi.fn(),
  hourOrderByMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => {
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.leftJoin = vi.fn().mockReturnValue(chain);
    // .where() returns an object that is:
    //   - BOTH directly awaitable (aggregate + milestoneAward terminals)
    //   - AND has .groupBy (goal categories terminal)
    //   - AND has .orderBy (loadActiveHourConfig terminal, API-064)
    chain.where = vi.fn(() =>
      Object.assign(Promise.resolve(aggWhereMock()), {
        groupBy: goalGroupByMock,
        orderBy: hourOrderByMock,
      }),
    );
    chain.groupBy = goalGroupByMock;
    chain.orderBy = hourOrderByMock;
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    },
  };
});

vi.mock('../src/services/auth/index.js', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
  setMailer: vi.fn(),
}));

import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';
import { getMyMilestones, MILESTONE_DEFS } from '../src/services/milestones.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-milestone-1';
const EARNED_AT = new Date('2026-03-15T10:00:00.000Z');

const CANONICAL_KEYS = [
  'first-experience',
  'hours-100',
  'hours-500',
  'hours-1000',
  'first-verified',
  'all-verified',
  'goal-1',
  'goal-2',
  'goal-all',
  'breadth-3',
];

function mockSession() {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: {
      id: TEST_USER_ID,
      name: 'Test User',
      email: 'test@example.com',
      twoFactorEnabled: true,
    } as never,
    session: { id: 'sess-1', userId: TEST_USER_ID, token: 'tok' } as never,
  });
}

/**
 * Configure DB mocks for one getMyMilestones call.
 *
 * @param aggRow    - Aggregate row for getMilestoneContext (experiences select)
 * @param awardRows - Rows from milestoneAward select
 * @param goalRows  - Rows from experience_categories goal select
 */
function setupMilestoneMocks(
  aggRow: Record<string, string>,
  awardRows: Array<{ key: string; earnedAt: Date }>,
  goalRows: Array<{ goalHours: number; userHours: string }> = [],
) {
  // aggWhereMock call 1 → experiences aggregate row
  aggWhereMock.mockReturnValueOnce([aggRow]);
  // aggWhereMock call 2 → milestoneAward rows
  aggWhereMock.mockReturnValueOnce(awardRows);
  // goalGroupByMock → goal categories
  goalGroupByMock.mockResolvedValueOnce(goalRows);
}

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('GET /api/me/milestones — unit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggWhereMock.mockReturnValue([]);
    goalGroupByMock.mockResolvedValue([]);
    // Default active hour config = migration-seeded three rows (API-064).
    hourOrderByMock.mockResolvedValue([
      { key: 'hours-100', label: '100 hours', thresholdHours: 100, isActive: true, sortOrder: 1 },
      { key: 'hours-500', label: '500 hours', thresholdHours: 500, isActive: true, sortOrder: 2 },
      { key: 'hours-1000', label: '1000 hours', thresholdHours: 1000, isActive: true, sortOrder: 3 },
    ]);
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me/milestones',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with one entry per canonical key', async () => {
    mockSession();
    // Context: 1 experience, 50 hours — earns 'first-experience', nothing else.
    setupMilestoneMocks(
      { totalHours: '50', experienceCount: '1', verifiedCount: '0', categoriesWithExperience: '1' },
      [{ key: 'first-experience', earnedAt: EARNED_AT }],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me/milestones',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Array<{
        key: string;
        label: string;
        earned: boolean;
        earnedAt: string | null;
        remainingLabel: string | null;
      }>;
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(CANONICAL_KEYS.length);
      expect(body.map((e) => e.key)).toEqual(CANONICAL_KEYS);

      // Earned milestone
      const earned = body.find((e) => e.key === 'first-experience')!;
      expect(earned.earned).toBe(true);
      expect(earned.earnedAt).not.toBeNull();
      expect(earned.remainingLabel).toBeNull();

      // Locked milestone
      const locked = body.find((e) => e.key === 'hours-100')!;
      expect(locked.earned).toBe(false);
      expect(locked.earnedAt).toBeNull();
      expect(locked.remainingLabel).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('earned milestones have earnedAt as ISO string and null remainingLabel', async () => {
    mockSession();
    setupMilestoneMocks(
      { totalHours: '120', experienceCount: '2', verifiedCount: '2', categoriesWithExperience: '2' },
      [
        { key: 'first-experience', earnedAt: EARNED_AT },
        { key: 'hours-100', earnedAt: EARNED_AT },
        { key: 'first-verified', earnedAt: EARNED_AT },
        { key: 'all-verified', earnedAt: EARNED_AT },
      ],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me/milestones',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Array<{
        key: string;
        earned: boolean;
        earnedAt: string | null;
        remainingLabel: string | null;
      }>;

      const earnedKeys = ['first-experience', 'hours-100', 'first-verified', 'all-verified'];
      for (const key of earnedKeys) {
        const entry = body.find((e) => e.key === key)!;
        expect(entry.earned, `${key} should be earned`).toBe(true);
        expect(entry.earnedAt, `${key} should have earnedAt`).toBe(EARNED_AT.toISOString());
        expect(entry.remainingLabel, `${key} should have null remainingLabel`).toBeNull();
      }

      const lockedKeys = CANONICAL_KEYS.filter((k) => !earnedKeys.includes(k));
      for (const key of lockedKeys) {
        const entry = body.find((e) => e.key === key)!;
        expect(entry.earned, `${key} should be locked`).toBe(false);
        expect(entry.earnedAt, `${key} should have null earnedAt`).toBeNull();
        expect(entry.remainingLabel, `${key} should have remainingLabel`).not.toBeNull();
      }
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Service unit test: stored-award-set semantics
// ---------------------------------------------------------------------------

describe('getMyMilestones — stored award set, not predicate re-derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggWhereMock.mockReturnValue([]);
    goalGroupByMock.mockResolvedValue([]);
    // Default active hour config = migration-seeded three rows (API-064).
    hourOrderByMock.mockResolvedValue([
      { key: 'hours-100', label: '100 hours', thresholdHours: 100, isActive: true, sortOrder: 1 },
      { key: 'hours-500', label: '500 hours', thresholdHours: 500, isActive: true, sortOrder: 2 },
      { key: 'hours-1000', label: '1000 hours', thresholdHours: 1000, isActive: true, sortOrder: 3 },
    ]);
  });

  it('returns earned: false when predicate is satisfied but no award row exists', async () => {
    // experienceCount: 1 satisfies the 'first-experience' predicate,
    // but the award row is NOT present in the milestoneAward mock.
    setupMilestoneMocks(
      { totalHours: '0', experienceCount: '1', verifiedCount: '0', categoriesWithExperience: '1' },
      [], // no award rows
    );

    const result = await getMyMilestones(TEST_USER_ID);
    const firstExperience = result.find((m) => m.key === 'first-experience')!;
    expect(firstExperience.earned).toBe(false);
    expect(firstExperience.earnedAt).toBeNull();
    expect(firstExperience.remainingLabel).not.toBeNull();
  });

  it('returns one entry per MILESTONE_DEFS key in definition order', async () => {
    setupMilestoneMocks(
      { totalHours: '0', experienceCount: '0', verifiedCount: '0', categoriesWithExperience: '0' },
      [],
    );

    const result = await getMyMilestones(TEST_USER_ID);
    expect(result.map((m) => m.key)).toEqual(MILESTONE_DEFS.map((d) => d.key));
  });

  it('correctly maps earnedAt from the stored date', async () => {
    setupMilestoneMocks(
      { totalHours: '0', experienceCount: '0', verifiedCount: '0', categoriesWithExperience: '0' },
      [{ key: 'first-experience', earnedAt: EARNED_AT }],
    );

    const result = await getMyMilestones(TEST_USER_ID);
    const m = result.find((e) => e.key === 'first-experience')!;
    expect(m.earned).toBe(true);
    expect(m.earnedAt).toBe(EARNED_AT.toISOString());
    expect(m.remainingLabel).toBeNull();
  });
});
