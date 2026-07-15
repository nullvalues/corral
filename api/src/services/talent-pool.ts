/**
 * Grant-scoped ranked talent pool (API-043).
 *
 * `listTalentPool(mentorUserId)` returns, for each applicant the caller holds an
 * ACTIVE mentor grant over (and who is NOT a system `admin`), the raw readiness
 * components: per-category hours/experience/verified counts (rollup-style,
 * zero-filled over ACTIVE categories) plus summed totals, the active-category
 * count, and the caller's OWN shortlist row (star rating + shortlisted flag).
 *
 * ABAC scope: the `mentor_grants` filter (`mentorUserId = caller AND status =
 * 'active'`) IS the per-row `hasMentorGrant` enforcement (D5) — an applicant
 * granted only to another mentor never appears in the caller's response. The
 * shortlist LEFT JOIN is filtered to `reviewer_user_id = caller`, so a different
 * reviewer's row for the same applicant is never disclosed (reviewer read
 * isolation, D7).
 *
 * The service returns only raw components — NO persisted readiness score. The
 * client computes and ranks (D1/D5). Postgres SUM/COUNT aggregates come back as
 * strings (same as getRollupByOwner) and are coerced with Number.
 */

import { db } from '../db/index.js';
import {
  experiences,
  experienceCategories,
  systemRoles,
  mentorGrants,
  interviewShortlist,
} from '../db/schema/index.js';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { applicantUsers } from './mentor-grants.js';
import { coerceCount, coerceSum } from '../db/aggregates.js';

export interface TalentCategory {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  totalHours: number;
  experienceCount: number;
  verifiedCount: number;
}

export interface TalentPoolEntry {
  applicantUserId: string;
  applicantName: string;
  applicantEmail: string;
  categories: TalentCategory[];
  experienceCount: number;
  verifiedCount: number;
  activeCategoryCount: number;
  shortlisted: boolean;
  starRating: number | null;
}

export async function listTalentPool(mentorUserId: string): Promise<TalentPoolEntry[]> {
  // 1. Resolve the caller's granted applicants (ABAC scope). The mentorGrants
  //    filter IS the per-row hasMentorGrant enforcement (D5).
  //    Uses the shared applicantUsers alias from mentor-grants.ts.
  const grantedApplicants = await db
    .select({ id: applicantUsers.id, name: applicantUsers.name, email: applicantUsers.email })
    .from(mentorGrants)
    .innerJoin(applicantUsers, eq(mentorGrants.applicantUserId, applicantUsers.id))
    .where(and(eq(mentorGrants.mentorUserId, mentorUserId), eq(mentorGrants.status, 'active')))
    .groupBy(applicantUsers.id, applicantUsers.name, applicantUsers.email);

  if (grantedApplicants.length === 0) return [];

  // 2. Drop any applicant who holds the `admin` system role (D5: admins excluded).
  const applicantIds = grantedApplicants.map((a) => a.id);
  const adminRows = await db
    .select({ userId: systemRoles.userId })
    .from(systemRoles)
    .where(and(inArray(systemRoles.userId, applicantIds), eq(systemRoles.role, 'admin')));
  const adminIds = new Set(adminRows.map((r) => r.userId));

  const applicants = grantedApplicants.filter((a) => !adminIds.has(a.id));
  if (applicants.length === 0) return [];

  // 3. Per applicant: category rollup (zero-filled over ACTIVE categories, with
  //    per-category counts) and the caller's own shortlist row.
  const entries: TalentPoolEntry[] = [];
  for (const applicant of applicants) {
    const categoryRows = await db
      .select({
        categoryId: experienceCategories.id,
        categorySlug: experienceCategories.slug,
        categoryName: experienceCategories.name,
        totalHours: sql<string>`COALESCE(SUM(${experiences.totalHours}), 0)`,
        experienceCount: sql<string>`COUNT(${experiences.id})`,
        verifiedCount: sql<string>`COUNT(*) FILTER (WHERE ${experiences.verificationStatus} = 'verified')`,
      })
      .from(experienceCategories)
      .leftJoin(
        experiences,
        and(
          eq(experiences.categoryId, experienceCategories.id),
          eq(experiences.ownerUserId, applicant.id),
        ),
      )
      .where(eq(experienceCategories.isActive, true))
      .groupBy(experienceCategories.id, experienceCategories.slug, experienceCategories.name)
      .orderBy(asc(experienceCategories.sortOrder));

    const categories: TalentCategory[] = categoryRows.map((r) => ({
      categoryId: r.categoryId,
      categorySlug: r.categorySlug,
      categoryName: r.categoryName,
      totalHours: coerceSum(r.totalHours),
      experienceCount: coerceCount(r.experienceCount),
      verifiedCount: coerceCount(r.verifiedCount),
    }));

    // reviewer read-isolation: only the caller's own row (D7).
    const [shortlistRow] = await db
      .select({
        shortlisted: interviewShortlist.shortlisted,
        starRating: interviewShortlist.starRating,
      })
      .from(interviewShortlist)
      .where(
        and(
          eq(interviewShortlist.applicantUserId, applicant.id),
          eq(interviewShortlist.reviewerUserId, mentorUserId),
        ),
      )
      .limit(1);

    entries.push({
      applicantUserId: applicant.id,
      applicantName: applicant.name,
      applicantEmail: applicant.email,
      categories,
      experienceCount: categories.reduce((sum, c) => sum + c.experienceCount, 0),
      verifiedCount: categories.reduce((sum, c) => sum + c.verifiedCount, 0),
      activeCategoryCount: categories.length,
      shortlisted: shortlistRow?.shortlisted ?? false,
      starRating: shortlistRow?.starRating ?? null,
    });
  }

  return entries;
}
