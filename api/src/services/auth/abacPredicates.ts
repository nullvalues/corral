import { db } from '../../db/index.js';
import { mentorGrants } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

export interface Owned {
  ownerId: string;
}

/**
 * ABAC ownership predicate. Pure — no DB call.
 * Caller pre-loads the resource and passes it in.
 */
export function isOwner(userId: string, resource: Owned): boolean {
  return userId === resource.ownerId;
}

/**
 * ABAC grant evaluator. DB call against mentor_grants only.
 * Does NOT reference system_roles or user.role.
 */
export async function hasMentorGrant(
  mentorUserId: string,
  applicantUserId: string,
  permission: string,
): Promise<boolean> {
  const rows = await db
    .select({ permissions: mentorGrants.permissions })
    .from(mentorGrants)
    .where(
      and(
        eq(mentorGrants.mentorUserId, mentorUserId),
        eq(mentorGrants.applicantUserId, applicantUserId),
        eq(mentorGrants.status, 'active'),
      ),
    )
    .limit(1);
  if (rows.length === 0) return false;
  return rows[0].permissions.includes(permission);
}
