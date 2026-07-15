/**
 * Unit tests for the milestone award worker (API-045).
 *
 * Unit project — no DATABASE_URL_TEST required. The DB is mocked; DB-backed
 * idempotency (re-run → 0 new rows against a live unique key) is TEST-054.
 *
 * Covers:
 *   - MILESTONE_DEFS contains exactly the ten canonical keys.
 *   - Predicate boundary cases (all-verified / goal-all locked at zero total;
 *     hours-500 earned at 500, locked at 499).
 *   - awardMilestones calls insert(...).onConflictDoNothing(...).returning(...)
 *     with one value per earned key, and returns the mocked returned keys.
 *   - awardMilestones returns [] when no predicate is met (no insert).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock. getMilestoneContext issues two selects (aggregate + goal rows);
// awardMilestones issues one insert chain. We stub the select chain terminals
// so getMilestoneContext returns a controllable context, and expose the insert
// chain mocks for assertion.
// ---------------------------------------------------------------------------

const {
  aggWhereMock,
  goalGroupByMock,
  hourOrderByMock,
  insertMock,
  valuesMock,
  onConflictMock,
  returningMock,
} = vi.hoisted(() => ({
  // aggregate select: .from().where()  → resolves the [agg] row
  aggWhereMock: vi.fn(),
  // goal select: .from().leftJoin().where().groupBy() → resolves goal rows
  goalGroupByMock: vi.fn(),
  // hour-config select (loadActiveHourConfig): .from().where().orderBy() → rows
  hourOrderByMock: vi.fn(),
  insertMock: vi.fn(),
  valuesMock: vi.fn(),
  onConflictMock: vi.fn(),
  returningMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => {
  // Each db.select() call returns a fresh chain object. Three query shapes share
  // the chain:
  //   - aggregate:     .from().where()               (awaits at .where())
  //   - goal rows:     .from().leftJoin().where().groupBy()
  //   - hour config:   .from().where().orderBy()      (loadActiveHourConfig)
  // We disambiguate by making .where() return an object that is awaitable
  // (aggregate terminal) AND exposes .groupBy (goal) and .orderBy (hour config).
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.leftJoin = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn((..._args: unknown[]) => {
      return Object.assign(Promise.resolve(aggWhereMock()), {
        groupBy: goalGroupByMock,
        orderBy: hourOrderByMock,
      });
    });
    chain.groupBy = goalGroupByMock;
    chain.orderBy = hourOrderByMock;
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: insertMock,
    },
  };
});

import {
  MILESTONE_DEFS,
  getMilestoneContext,
  awardMilestones,
  type MilestoneCtx,
} from '../src/services/milestones.js';

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

function findDef(key: string) {
  const def = MILESTONE_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`missing milestone def: ${key}`);
  return def;
}

const baseCtx: MilestoneCtx = {
  totalHours: 0,
  experienceCount: 0,
  verifiedCount: 0,
  goalCategoriesMet: 0,
  goalCategoriesTotal: 0,
  categoriesWithExperience: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  aggWhereMock.mockReturnValue([]);
  goalGroupByMock.mockResolvedValue([]);
  // Default active hour config = the migration-seeded three rows, so
  // awardMilestones evaluates the canonical hour milestones unless a test
  // overrides it.
  hourOrderByMock.mockResolvedValue([
    { key: 'hours-100', label: '100 hours', thresholdHours: 100, isActive: true, sortOrder: 1 },
    { key: 'hours-500', label: '500 hours', thresholdHours: 500, isActive: true, sortOrder: 2 },
    { key: 'hours-1000', label: '1000 hours', thresholdHours: 1000, isActive: true, sortOrder: 3 },
  ]);
  insertMock.mockReturnValue({ values: valuesMock });
  valuesMock.mockReturnValue({ onConflictDoNothing: onConflictMock });
  onConflictMock.mockReturnValue({ returning: returningMock });
  returningMock.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// MILESTONE_DEFS shape
// ---------------------------------------------------------------------------

describe('MILESTONE_DEFS', () => {
  it('contains exactly the ten canonical keys in order', () => {
    expect(MILESTONE_DEFS.map((d) => d.key)).toEqual(CANONICAL_KEYS);
  });
});

// ---------------------------------------------------------------------------
// Predicate boundary cases
// ---------------------------------------------------------------------------

describe('milestone predicate boundaries', () => {
  it('all-verified is locked when experienceCount is 0 (not vacuously earned)', () => {
    expect(findDef('all-verified').earned({ ...baseCtx, experienceCount: 0, verifiedCount: 0 })).toBe(
      false,
    );
  });

  it('all-verified is earned when every experience is verified', () => {
    expect(
      findDef('all-verified').earned({ ...baseCtx, experienceCount: 3, verifiedCount: 3 }),
    ).toBe(true);
  });

  it('goal-all is locked when goalCategoriesTotal is 0', () => {
    expect(
      findDef('goal-all').earned({ ...baseCtx, goalCategoriesTotal: 0, goalCategoriesMet: 0 }),
    ).toBe(false);
  });

  it('hours-500 is earned at exactly 500 and locked at 499', () => {
    expect(findDef('hours-500').earned({ ...baseCtx, totalHours: 500 })).toBe(true);
    expect(findDef('hours-500').earned({ ...baseCtx, totalHours: 499 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMilestoneContext coercion
// ---------------------------------------------------------------------------

describe('getMilestoneContext', () => {
  it('coerces Postgres aggregate strings and derives goal counts', async () => {
    aggWhereMock.mockReturnValue([
      {
        totalHours: '620',
        experienceCount: '4',
        verifiedCount: '2',
        categoriesWithExperience: '3',
      },
    ]);
    // Two goal-bearing categories; the user meets one (100 >= 100), misses one (40 < 100).
    goalGroupByMock.mockResolvedValue([
      { goalHours: 100, userHours: '100' },
      { goalHours: 100, userHours: '40' },
    ]);

    const ctx = await getMilestoneContext('user-1');
    expect(ctx).toEqual({
      totalHours: 620,
      experienceCount: 4,
      verifiedCount: 2,
      goalCategoriesMet: 1,
      goalCategoriesTotal: 2,
      categoriesWithExperience: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// awardMilestones insert behaviour
// ---------------------------------------------------------------------------

describe('awardMilestones', () => {
  it('inserts one value per earned key and returns the newly-inserted keys', async () => {
    // One verified experience with 120 hrs earns: first-experience, hours-100,
    // first-verified, all-verified (1 of 1 verified). No goal categories.
    aggWhereMock.mockReturnValue([
      {
        totalHours: '120',
        experienceCount: '1',
        verifiedCount: '1',
        categoriesWithExperience: '1',
      },
    ]);
    goalGroupByMock.mockResolvedValue([]);
    const earned = ['first-experience', 'hours-100', 'first-verified', 'all-verified'];
    returningMock.mockResolvedValue(earned.map((milestoneKey) => ({ milestoneKey })));

    const result = await awardMilestones('user-1');

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledTimes(1);
    const insertedValues = valuesMock.mock.calls[0][0] as Array<{
      userId: string;
      milestoneKey: string;
    }>;
    expect(insertedValues).toEqual(earned.map((milestoneKey) => ({ userId: 'user-1', milestoneKey })));
    expect(onConflictMock).toHaveBeenCalledTimes(1);
    expect(returningMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(earned);
  });

  it('returns [] and does not insert when no predicate is met', async () => {
    aggWhereMock.mockReturnValue([
      {
        totalHours: '0',
        experienceCount: '0',
        verifiedCount: '0',
        categoriesWithExperience: '0',
      },
    ]);
    goalGroupByMock.mockResolvedValue([]);

    const result = await awardMilestones('user-empty');

    expect(result).toEqual([]);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('returns [] on an idempotent re-run (all earned keys already present)', async () => {
    aggWhereMock.mockReturnValue([
      {
        totalHours: '120',
        experienceCount: '1',
        verifiedCount: '1',
        categoriesWithExperience: '1',
      },
    ]);
    goalGroupByMock.mockResolvedValue([]);
    // onConflictDoNothing swallows every row → returning() yields [].
    returningMock.mockResolvedValue([]);

    const result = await awardMilestones('user-1');
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });
});
