import { db } from '../db/index.js';
import { experiences, experienceCategories } from '../db/schema/index.js';
import { eq, and, asc, sql, type InferInsertModel } from 'drizzle-orm';
import { hasMentorGrant } from './auth/abacPredicates.js';
import { insertPiiAccessLog } from './pii-access-log.js';
import { awardMilestones } from './milestones.js';
import { coerceSum } from '../db/aggregates.js';

export async function listExperiencesByOwner(ownerUserId: string) {
  return db.select().from(experiences).where(eq(experiences.ownerUserId, ownerUserId));
}

export async function getExperienceById(id: string) {
  const [row] = await db.select().from(experiences).where(eq(experiences.id, id)).limit(1);
  return row ?? null;
}

export type NewExperience = InferInsertModel<typeof experiences>;

export async function createExperience(data: NewExperience) {
  const [row] = await db.insert(experiences).values(data).returning();
  // Award any newly-earned milestones as a side effect of the create (API-045).
  await awardMilestones(row.ownerUserId);
  return row;
}

export async function updateExperience(
  id: string,
  data: Partial<Omit<NewExperience, 'id' | 'ownerUserId' | 'createdAt'>>,
) {
  const [row] = await db
    .update(experiences)
    .set({
      ...data,
      verificationStatus: 'unverified',
      verifiedByUserId: null,
      verifiedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(experiences.id, id))
    .returning();
  // Award any newly-earned milestones as a side effect of the update (API-045).
  if (row) await awardMilestones(row.ownerUserId);
  return row ?? null;
}

export async function deleteExperience(id: string): Promise<boolean> {
  const result = await db
    .delete(experiences)
    .where(eq(experiences.id, id))
    .returning({ id: experiences.id });
  return result.length > 0;
}

export async function getRollupByOwner(ownerUserId: string) {
  const rows = await db
    .select({
      categoryId: experienceCategories.id,
      categorySlug: experienceCategories.slug,
      categoryName: experienceCategories.name,
      totalHours: sql<string>`COALESCE(SUM(${experiences.totalHours}), 0)`,
    })
    .from(experienceCategories)
    .leftJoin(
      experiences,
      and(
        eq(experiences.categoryId, experienceCategories.id),
        eq(experiences.ownerUserId, ownerUserId),
      ),
    )
    .groupBy(experienceCategories.id, experienceCategories.slug, experienceCategories.name)
    .orderBy(asc(experienceCategories.sortOrder));
  return rows.map((r) => ({ ...r, totalHours: coerceSum(r.totalHours) }));
}

export type VerifyAction = 'verify' | 'unverify';

export type VerifyExperienceResult =
  | { ok: true; experience: NonNullable<Awaited<ReturnType<typeof getExperienceById>>> }
  | { ok: false; code: 'forbidden' };

/**
 * Mentor verify / un-verify an experience (API-033, ADR-035).
 *
 * - Loads the experience; `not_found` if missing.
 * - Requires an active mentor grant with `'write'` permission over the
 *   experience's owner; `forbidden` otherwise.
 * - Disallows self-verification (owner cannot verify their own experience).
 * - Applies the verification state change and writes a `pii_access_log` row
 *   (action: `'update'`) — verification actions ARE audited (resolves CER-012).
 */
export async function verifyExperience(
  mentorUserId: string,
  experienceId: string,
  action: VerifyAction,
): Promise<VerifyExperienceResult> {
  const exp = await getExperienceById(experienceId);
  // Non-disclosure: a caller without write access cannot distinguish a missing
  // experience from one they may not touch — both return forbidden (CER-035).
  if (!exp) return { ok: false, code: 'forbidden' };

  // Self-verification guard: the owner may never verify their own experience.
  if (exp.ownerUserId === mentorUserId) return { ok: false, code: 'forbidden' };

  const granted = await hasMentorGrant(mentorUserId, exp.ownerUserId, 'write');
  if (!granted) return { ok: false, code: 'forbidden' };

  const patch =
    action === 'verify'
      ? {
          verificationStatus: 'verified',
          verifiedByUserId: mentorUserId,
          verifiedAt: new Date(),
        }
      : {
          verificationStatus: 'unverified',
          verifiedByUserId: null,
          verifiedAt: null,
        };

  const [updated] = await db
    .update(experiences)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(experiences.id, experienceId))
    .returning();

  // Verification is a mutation of the experience record — audited as an 'update'.
  insertPiiAccessLog({
    actorUserId: mentorUserId,
    action: 'update',
    resourceType: 'experience',
    resourceId: experienceId,
    subjectUserId: exp.ownerUserId,
    viaGrant: true,
  });

  // Verification can change milestone state (first-verified / all-verified) —
  // award as a side effect keyed on the experience's owner (API-045).
  await awardMilestones(exp.ownerUserId);

  return { ok: true, experience: updated };
}

/** Apply PII gate: null out contact fields for non-owner when permissionToContact is false */
export function applyPiiGate<
  T extends {
    permissionToContact: boolean;
    contactTitle: string | null;
    contactFirstName: string | null;
    contactLastName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  },
>(exp: T, isOwner: boolean): T {
  if (!isOwner && !exp.permissionToContact) {
    return {
      ...exp,
      contactTitle: null,
      contactFirstName: null,
      contactLastName: null,
      contactEmail: null,
      contactPhone: null,
    };
  }
  return exp;
}
