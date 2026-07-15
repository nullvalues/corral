/**
 * Derived mentor impact statistics (API-040).
 *
 * Per the no-table decision (PM035 / ADR-031 caveat), these figures are
 * **computed, never stored** — there is no impact table or column. All inputs
 * are aggregated on demand from `experiences` (rows the caller verified) and
 * `mentor_grants` (active grants for the pending count).
 *
 * `createdAt` is used as a submission-time proxy for turnaround math: the
 * `experiences` table has no dedicated "submitted at" column, so
 * `verifiedAt − createdAt` is the best available approximation of how long a
 * verification took. This caveat is recorded in the PM035 ADR.
 *
 * The aggregation is always scoped to a single mentor id supplied by the
 * caller — the route layer passes `req.user.id` only, never a query param, so
 * a caller can never read another mentor's stats (ABAC guarantee).
 */

import { db } from '../db/index.js';
import { experiences, mentorGrants } from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { coerceCount, coerceSum } from '../db/aggregates.js';

export interface MentorImpact {
  monthHoursVerified: number;
  lifetimeHoursVerified: number;
  applicantsMentored: number;
  avgTurnaroundHours: number | null;
  streakDays: number;
  pendingVerifications: number;
}

/**
 * Compute the length of the consecutive run of UTC calendar days, ending today,
 * on which the caller made at least one verification.
 *
 * - Returns 0 when the caller did not verify anything today (the run must end
 *   on the current UTC day).
 * - Breaks at the first prior day with no verification.
 *
 * Pulled out of the DB query so the run calculation is unit-testable in
 * isolation. `verificationDays` are distinct `'YYYY-MM-DD'` UTC date strings.
 */
export function computeStreakDays(
  verificationDays: string[],
  today: Date = new Date(),
): number {
  const MS_PER_DAY = 86_400_000;
  const dayNums = new Set(
    verificationDays.map((d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / MS_PER_DAY)),
  );
  const todayNum = Math.floor(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / MS_PER_DAY,
  );
  let streak = 0;
  let cursor = todayNum;
  while (dayNums.has(cursor)) {
    streak++;
    cursor--;
  }
  return streak;
}

/**
 * Aggregate the caller's own verification activity. See module header for the
 * no-table / createdAt-proxy / self-scoping rationale.
 */
export async function getMentorImpact(mentorUserId: string): Promise<MentorImpact> {
  // Hours sums + distinct applicants + average turnaround, over rows this
  // mentor verified. Postgres aggregates come back as strings (same as
  // getRollupByOwner) so each is coerced with Number.
  const [agg] = await db
    .select({
      monthHours: sql<string>`COALESCE(SUM(${experiences.totalHours}) FILTER (WHERE ${experiences.verifiedAt} >= date_trunc('month', now())), 0)`,
      lifetimeHours: sql<string>`COALESCE(SUM(${experiences.totalHours}), 0)`,
      applicants: sql<string>`COUNT(DISTINCT ${experiences.ownerUserId})`,
      avgTurnaround: sql<
        string | null
      >`AVG(EXTRACT(EPOCH FROM (${experiences.verifiedAt} - ${experiences.createdAt})) / 3600.0)`,
    })
    .from(experiences)
    .where(eq(experiences.verifiedByUserId, mentorUserId));

  // Distinct UTC verification days for the caller, newest first. The run is
  // computed in TS (computeStreakDays) for testability.
  const dayRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${experiences.verifiedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
    })
    .from(experiences)
    .where(eq(experiences.verifiedByUserId, mentorUserId))
    .groupBy(sql`date_trunc('day', ${experiences.verifiedAt} AT TIME ZONE 'UTC')`)
    .orderBy(sql`date_trunc('day', ${experiences.verifiedAt} AT TIME ZONE 'UTC') DESC`);

  // Pending = unverified experiences owned by applicants for whom the caller
  // holds an ACTIVE grant. NOT limited to rows the caller already verified.
  const [pendingRow] = await db
    .select({ count: sql<string>`COUNT(DISTINCT ${experiences.id})` })
    .from(experiences)
    .innerJoin(mentorGrants, eq(mentorGrants.applicantUserId, experiences.ownerUserId))
    .where(
      and(
        eq(mentorGrants.mentorUserId, mentorUserId),
        eq(mentorGrants.status, 'active'),
        eq(experiences.verificationStatus, 'unverified'),
      ),
    );

  const avgRaw = agg?.avgTurnaround ?? null;
  const avgTurnaroundHours = avgRaw === null ? null : Math.round(Number(avgRaw) * 10) / 10;

  return {
    monthHoursVerified: coerceSum(agg?.monthHours),
    lifetimeHoursVerified: coerceSum(agg?.lifetimeHours),
    applicantsMentored: coerceCount(agg?.applicants),
    avgTurnaroundHours,
    streakDays: computeStreakDays(dayRows.map((r) => r.day)),
    pendingVerifications: coerceCount(pendingRow?.count),
  };
}
