import { db } from '../db/index.js';
import { mentorGrants, systemRoles } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

/**
 * Returns the list of roles assigned to the given user in system_roles.
 * API-023.
 */
export async function getMyRoles(userId: string): Promise<string[]> {
  const rows = await db
    .select({ role: systemRoles.role })
    .from(systemRoles)
    .where(eq(systemRoles.userId, userId));
  return rows.map((r) => r.role);
}

/**
 * Returns true if the user has at least one active mentor grant as a mentor.
 * Does NOT check specific permissions — use hasMentorGrant() from abacPredicates.ts
 * for permission-specific checks.
 * API-023.
 */
export async function getHasActiveMentorGrants(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: mentorGrants.id })
    .from(mentorGrants)
    .where(and(eq(mentorGrants.mentorUserId, userId), eq(mentorGrants.status, 'active')))
    .limit(1);
  return rows.length > 0;
}
