/**
 * Milestone award worker + config (API-045, Phase PM038-main; API-064, PM052-main).
 *
 * This is the authoritative **server-side writer** for the canonical milestone
 * set. It evaluates the milestone predicates for a user against live DB state
 * and INSERTs a `milestone_award` row for every newly-earned milestone,
 * idempotently (`onConflictDoNothing` on the `(user_id, milestone_key)` unique
 * key). The worker performs no access decision of its own — it is invoked from
 * inside already-authorised experience mutation handlers (create/update/verify),
 * so the caller was already authorised to change the affected experience.
 *
 * MILESTONE SPLIT (API-064, supersedes ADR-041 for hour milestones):
 *   - STRUCTURAL milestones (first-experience, first-verified, all-verified,
 *     goal-1, goal-2, goal-all, breadth-3) are code-defined here: their earned
 *     predicate cannot be reduced to a single stored hour threshold.
 *   - HOUR-THRESHOLD milestones (hours-100, hours-500, hours-1000, …) are loaded
 *     at runtime from the `milestone_config` table (`WHERE is_active = true`,
 *     ordered by `sort_order`). An admin adds/relabels/re-thresholds/deactivates
 *     them via PUT /api/admin/milestone-config/:key with NO code deploy.
 *
 * ADR-041 SUPERSESSION: the server is now the single source of truth for
 * hour-threshold definitions. `ui/src/lib/milestones.ts` no longer mirrors the
 * hour-threshold list — the client displays the fully-evaluated results returned
 * by GET /api/me/milestones. Structural keys/predicates still mirror the UI's
 * structural display metadata.
 *
 * CONFIG-CHANGE TOLERANCE: awards are historical facts. An already-awarded key
 * whose `milestone_config` row is later deactivated or re-thresholded is NEVER
 * retro-revoked — the stored `milestone_award` row stays and GET /api/me/milestones
 * continues to report it as earned. Deactivation / re-thresholding only changes
 * whether the key is awardable (and evaluated as locked/unlocked) going forward.
 */

import { db } from '../db/index.js';
import {
  experiences,
  experienceCategories,
  milestoneAward,
  milestoneConfig,
} from '../db/schema/index.js';
import { users } from '../db/schema/auth.js';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { coerceCount, coerceSum } from '../db/aggregates.js';

export interface MilestoneCtx {
  totalHours: number;
  experienceCount: number;
  verifiedCount: number;
  goalCategoriesMet: number;
  goalCategoriesTotal: number;
  categoriesWithExperience: number;
}

interface MilestoneDef {
  key: string;
  label: string;
  earned: (c: MilestoneCtx) => boolean;
  remaining: (c: MilestoneCtx) => string;
}

export interface MilestoneView {
  key: string;
  label: string;
  earned: boolean;
  earnedAt: string | null;
  remainingLabel: string | null;
}

export interface MilestoneConfigRow {
  key: string;
  label: string;
  thresholdHours: number;
  isActive: boolean;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// STRUCTURAL milestones (API-064). Code-defined — their earned predicate cannot
// be reduced to a stored hour threshold. Keys + structural display metadata
// mirror ui/src/lib/milestones.ts. Hour-threshold milestones live in the
// `milestone_config` table and are merged in at runtime (see buildMilestoneDefs).
//
// `first-experience` is emitted first, then hour milestones, then the remaining
// structural entries — matching the historical MILESTONE_DEFS ordering so
// existing views render unchanged out of the box.
// ---------------------------------------------------------------------------
const FIRST_EXPERIENCE_DEF: MilestoneDef = {
  key: 'first-experience',
  label: 'First experience',
  earned: (c) => c.experienceCount >= 1,
  remaining: () => '1 to go',
};

const STRUCTURAL_TAIL_DEFS: MilestoneDef[] = [
  {
    key: 'first-verified',
    label: 'First verified',
    earned: (c) => c.verifiedCount >= 1,
    remaining: () => '1 to go',
  },
  {
    key: 'all-verified',
    label: 'All verified',
    earned: (c) => c.experienceCount > 0 && c.verifiedCount === c.experienceCount,
    remaining: (c) => `${Math.max(0, c.experienceCount - c.verifiedCount)} to go`,
  },
  {
    key: 'goal-1',
    label: '1 goal met',
    earned: (c) => c.goalCategoriesMet >= 1,
    remaining: () => '1 to go',
  },
  {
    key: 'goal-2',
    label: '2 goals met',
    earned: (c) => c.goalCategoriesMet >= 2,
    remaining: (c) => `${Math.max(0, 2 - c.goalCategoriesMet)} to go`,
  },
  {
    key: 'goal-all',
    label: 'All goals met',
    earned: (c) => c.goalCategoriesTotal > 0 && c.goalCategoriesMet === c.goalCategoriesTotal,
    remaining: (c) => `${Math.max(0, c.goalCategoriesTotal - c.goalCategoriesMet)} to go`,
  },
  {
    key: 'breadth-3',
    label: '3 categories',
    earned: (c) => c.categoriesWithExperience >= 3,
    remaining: (c) => `${Math.max(0, 3 - c.categoriesWithExperience)} to go`,
  },
];

// Default hour-threshold seed, mirrored by migration 0031_milestone_config.sql.
// This constant is ONLY the out-of-the-box default used to keep the legacy
// exported `MILESTONE_DEFS` (below) stable for consumers that expect the ten
// canonical keys. Runtime evaluation reads the live `milestone_config` table,
// NOT this array — operator edits are honoured.
const DEFAULT_HOUR_CONFIG: MilestoneConfigRow[] = [
  { key: 'hours-100', label: '100 hours', thresholdHours: 100, isActive: true, sortOrder: 1 },
  { key: 'hours-500', label: '500 hours', thresholdHours: 500, isActive: true, sortOrder: 2 },
  { key: 'hours-1000', label: '1000 hours', thresholdHours: 1000, isActive: true, sortOrder: 3 },
];

/**
 * Build a MilestoneDef for one hour-threshold config row. The earned predicate
 * is derived from `thresholdHours` (`totalHours >= thresholdHours`); the locked
 * label counts remaining hours to the configured threshold.
 */
function hourDef(row: MilestoneConfigRow): MilestoneDef {
  return {
    key: row.key,
    label: row.label,
    earned: (c) => c.totalHours >= row.thresholdHours,
    remaining: (c) => `${Math.max(0, row.thresholdHours - c.totalHours)} to go`,
  };
}

/**
 * Merge the code-defined structural milestones with the supplied hour-threshold
 * config rows into a single ordered definition list. Ordering: first-experience,
 * then the hour milestones (in the caller's order), then the structural tail.
 * Callers pass live `milestone_config` rows; the default seed reproduces the
 * historical ten-key ordering.
 */
export function buildMilestoneDefs(hourRows: MilestoneConfigRow[]): MilestoneDef[] {
  return [FIRST_EXPERIENCE_DEF, ...hourRows.map(hourDef), ...STRUCTURAL_TAIL_DEFS];
}

// Backward-compatible export: structural milestones merged with the DEFAULT hour
// seed. This preserves the historical ten canonical keys for consumers/tests
// that reference the static list. Runtime award + read paths use the live
// `milestone_config` table via loadActiveHourConfig(), not this constant.
export const MILESTONE_DEFS: MilestoneDef[] = buildMilestoneDefs(DEFAULT_HOUR_CONFIG);

/**
 * Load the active hour-threshold milestone config from the DB, ordered by
 * `sort_order`. Only `is_active = true` rows participate in evaluation — a
 * deactivated row stops being awardable/evaluated (already-earned awards are
 * never revoked; see the file header).
 */
export async function loadActiveHourConfig(): Promise<MilestoneConfigRow[]> {
  return db
    .select({
      key: milestoneConfig.key,
      label: milestoneConfig.label,
      thresholdHours: milestoneConfig.thresholdHours,
      isActive: milestoneConfig.isActive,
      sortOrder: milestoneConfig.sortOrder,
    })
    .from(milestoneConfig)
    .where(eq(milestoneConfig.isActive, true))
    .orderBy(asc(milestoneConfig.sortOrder));
}

/**
 * List every milestone_config row (active and inactive), ordered by sort_order —
 * the admin management read for GET /api/admin/milestone-config. API-064.
 */
export async function listMilestoneConfig(): Promise<MilestoneConfigRow[]> {
  return db
    .select({
      key: milestoneConfig.key,
      label: milestoneConfig.label,
      thresholdHours: milestoneConfig.thresholdHours,
      isActive: milestoneConfig.isActive,
      sortOrder: milestoneConfig.sortOrder,
    })
    .from(milestoneConfig)
    .orderBy(asc(milestoneConfig.sortOrder));
}

/**
 * Update a single milestone_config row by its immutable `key`. Only label,
 * thresholdHours, isActive, and sortOrder are mutable. Returns the updated row,
 * or null when the key does not exist (route responds 404). API-064.
 */
export async function updateMilestoneConfig(
  key: string,
  patch: {
    label: string;
    thresholdHours: number;
    isActive: boolean;
    sortOrder: number;
  },
): Promise<MilestoneConfigRow | null> {
  const [row] = await db
    .update(milestoneConfig)
    .set({
      label: patch.label,
      thresholdHours: patch.thresholdHours,
      isActive: patch.isActive,
      sortOrder: patch.sortOrder,
    })
    .where(eq(milestoneConfig.key, key))
    .returning({
      key: milestoneConfig.key,
      label: milestoneConfig.label,
      thresholdHours: milestoneConfig.thresholdHours,
      isActive: milestoneConfig.isActive,
      sortOrder: milestoneConfig.sortOrder,
    });

  return row ?? null;
}

export interface MilestoneAwardRow {
  id: string;
  userId: string;
  email: string | null;
  milestoneKey: string;
  earnedAt: Date;
}

export interface ListMilestoneAwardsOpts {
  userId?: string;
  limit?: number;
}

/**
 * List stored milestone_award rows, LEFT JOINed to users for the email column.
 * Optional userId filter; ordered by earned_at DESC; limit clamped to 200 (default 100).
 * Mirror of listPiiAccessLog (api/src/services/pii-access-log.ts).
 * API-045 / UI-081.
 */
export async function listMilestoneAwards(
  opts: ListMilestoneAwardsOpts,
): Promise<MilestoneAwardRow[]> {
  const limit = Math.min(opts.limit ?? 100, 200);

  const rows = await db
    .select({
      id: milestoneAward.id,
      userId: milestoneAward.userId,
      email: users.email,
      milestoneKey: milestoneAward.milestoneKey,
      earnedAt: milestoneAward.earnedAt,
    })
    .from(milestoneAward)
    .leftJoin(users, eq(users.id, milestoneAward.userId))
    .where(opts.userId ? eq(milestoneAward.userId, opts.userId) : undefined)
    .orderBy(desc(milestoneAward.earnedAt))
    .limit(limit);

  return rows;
}

/**
 * Compute the live milestone evaluation context for a user from the DB.
 *
 * Postgres SUM/COUNT aggregates come back as strings (same as
 * `getRollupByOwner`), so every aggregate is coerced via `coerceSum` /
 * `coerceCount` from `db/aggregates.ts` (API-055).
 */
export async function getMilestoneContext(userId: string): Promise<MilestoneCtx> {
  // Per-user totals/counts over the user's experiences.
  const [agg] = await db
    .select({
      totalHours: sql<string>`COALESCE(SUM(${experiences.totalHours}), 0)`,
      experienceCount: sql<string>`COUNT(*)`,
      verifiedCount: sql<string>`COUNT(*) FILTER (WHERE ${experiences.verificationStatus} = 'verified')`,
      categoriesWithExperience: sql<string>`COUNT(DISTINCT ${experiences.categoryId})`,
    })
    .from(experiences)
    .where(eq(experiences.ownerUserId, userId));

  // Goal-bearing categories (active + goal_hours set) joined to the user's
  // per-category hour sums. goalCategoriesTotal = number of such categories;
  // goalCategoriesMet = those where the user's summed hours meets the goal.
  const goalRows = await db
    .select({
      goalHours: experienceCategories.goalHours,
      userHours: sql<string>`COALESCE(SUM(${experiences.totalHours}), 0)`,
    })
    .from(experienceCategories)
    .leftJoin(
      experiences,
      and(
        eq(experiences.categoryId, experienceCategories.id),
        eq(experiences.ownerUserId, userId),
      ),
    )
    .where(
      and(
        eq(experienceCategories.isActive, true),
        sql`${experienceCategories.goalHours} IS NOT NULL`,
      ),
    )
    .groupBy(experienceCategories.id, experienceCategories.goalHours);

  const goalCategoriesTotal = goalRows.length;
  const goalCategoriesMet = goalRows.filter(
    (r) => r.goalHours !== null && coerceSum(r.userHours) >= r.goalHours,
  ).length;

  return {
    totalHours: coerceSum(agg?.totalHours),
    experienceCount: coerceCount(agg?.experienceCount),
    verifiedCount: coerceCount(agg?.verifiedCount),
    goalCategoriesMet,
    goalCategoriesTotal,
    categoriesWithExperience: coerceCount(agg?.categoriesWithExperience),
  };
}

/**
 * Read the caller's stored milestone state from `milestone_award` and return
 * one `MilestoneView` per `MILESTONE_DEFS` key, in definition order.
 *
 * `earned` reflects the **stored** award rows only — the predicate is NOT
 * re-evaluated here, so a user whose context satisfies a predicate but has no
 * award row yet (rare race) will still see `earned: false` until the next
 * `awardMilestones` run.
 *
 * API-046.
 */
export async function getMyMilestones(userId: string): Promise<MilestoneView[]> {
  const [ctx, awarded, hourConfig] = await Promise.all([
    getMilestoneContext(userId),
    db
      .select({ key: milestoneAward.milestoneKey, earnedAt: milestoneAward.earnedAt })
      .from(milestoneAward)
      .where(eq(milestoneAward.userId, userId)),
    loadActiveHourConfig(),
  ]);

  const earnedMap = new Map<string, Date>(awarded.map((r) => [r.key, r.earnedAt]));
  const defs = buildMilestoneDefs(hourConfig);

  return defs.map((def) => {
    const earned = earnedMap.has(def.key);
    return {
      key: def.key,
      label: def.label,
      earned,
      earnedAt: earned ? earnedMap.get(def.key)!.toISOString() : null,
      remainingLabel: earned ? null : def.remaining(ctx),
    };
  });
}

/**
 * Evaluate every milestone predicate for a user and persist an award row for
 * each earned milestone. Idempotent: the unique `(user_id, milestone_key)` key
 * plus `onConflictDoNothing` guarantees a re-run for an unchanged user inserts
 * zero rows.
 *
 * Returns the list of milestone keys that were **newly** inserted this run
 * (the `.returning()` result) — an empty array when nothing new was earned and
 * on every subsequent idempotent re-run.
 */
export async function awardMilestones(userId: string): Promise<string[]> {
  const [ctx, hourConfig] = await Promise.all([
    getMilestoneContext(userId),
    loadActiveHourConfig(),
  ]);
  const defs = buildMilestoneDefs(hourConfig);
  const earnedKeys = defs.filter((d) => d.earned(ctx)).map((d) => d.key);

  if (earnedKeys.length === 0) return [];

  const inserted = await db
    .insert(milestoneAward)
    .values(earnedKeys.map((k) => ({ userId, milestoneKey: k })))
    .onConflictDoNothing({ target: [milestoneAward.userId, milestoneAward.milestoneKey] })
    .returning({ milestoneKey: milestoneAward.milestoneKey });

  return inserted.map((r) => r.milestoneKey);
}
