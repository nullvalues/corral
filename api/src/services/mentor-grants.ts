import { randomUUID } from 'crypto';
import { desc, and, eq, or, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/index.js';
import { mentorGrants } from '../db/schema/index.js';
import { users } from '../db/schema/auth.js';

// Shared alias declarations — defined once and exported for reuse in other services
// (e.g. talent-pool.ts) that also need to join users twice in the same query.
export const applicantUsers = alias(users, 'applicant_users');
export const mentorUsers = alias(users, 'mentor_users');

/**
 * Shared enrichment helper. Maps applicant and mentor user rows onto a grant row,
 * producing the canonical applicantName/applicantEmail/mentorName/mentorEmail fields
 * in exactly one place.
 */
export function enrichGrantWithUsers<G>(
  grantRow: G,
  applicantUser: { name: string | null; email: string } | null,
  mentorUser: { name: string | null; email: string } | null,
) {
  return {
    ...grantRow,
    applicantName: applicantUser?.name ?? null,
    applicantEmail: applicantUser?.email ?? null,
    mentorName: mentorUser?.name ?? null,
    mentorEmail: mentorUser?.email ?? null,
  };
}

export async function listMentorGrants(filters: {
  mentorUserId?: string;
  applicantUserId?: string;
  status?: string;
}) {
  const conditions = [];
  if (filters.mentorUserId) conditions.push(eq(mentorGrants.mentorUserId, filters.mentorUserId));
  if (filters.applicantUserId) conditions.push(eq(mentorGrants.applicantUserId, filters.applicantUserId));
  if (filters.status) conditions.push(eq(mentorGrants.status, filters.status));

  return db
    .select({
      ...getTableColumns(mentorGrants),
      applicantName: applicantUsers.name,
      applicantEmail: applicantUsers.email,
      mentorName: mentorUsers.name,
      mentorEmail: mentorUsers.email,
    })
    .from(mentorGrants)
    .innerJoin(applicantUsers, eq(mentorGrants.applicantUserId, applicantUsers.id))
    .innerJoin(mentorUsers, eq(mentorGrants.mentorUserId, mentorUsers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(mentorGrants.grantedAt));
}

export async function createMentorGrant(input: {
  mentorUserId: string;
  applicantUserId: string;
  permissions: string[];
  grantedByUserId: string;
}) {
  const [grant] = await db
    .insert(mentorGrants)
    .values({
      id: randomUUID(),
      mentorUserId: input.mentorUserId,
      applicantUserId: input.applicantUserId,
      permissions: input.permissions,
      grantedByUserId: input.grantedByUserId,
      status: 'active',
    })
    .returning();
  return grant;
}

export async function listMyMentorGrants(mentorUserId: string) {
  return db
    .select({
      ...getTableColumns(mentorGrants),
      applicantName: applicantUsers.name,
      applicantEmail: applicantUsers.email,
    })
    .from(mentorGrants)
    .innerJoin(applicantUsers, eq(mentorGrants.applicantUserId, applicantUsers.id))
    .where(and(eq(mentorGrants.mentorUserId, mentorUserId), eq(mentorGrants.status, 'active')));
}

export async function listMyApplicantGrants(applicantUserId: string) {
  return db
    .select({
      ...getTableColumns(mentorGrants),
      mentorName: mentorUsers.name,
      mentorEmail: mentorUsers.email,
    })
    .from(mentorGrants)
    .innerJoin(mentorUsers, eq(mentorGrants.mentorUserId, mentorUsers.id))
    .where(eq(mentorGrants.applicantUserId, applicantUserId))
    .orderBy(desc(mentorGrants.grantedAt));
}

export async function getMentorGrantById(id: string) {
  const [grant] = await db.select().from(mentorGrants).where(eq(mentorGrants.id, id)).limit(1);
  return grant ?? null;
}

export async function requestMentorGrant(applicantUserId: string, mentorEmail: string) {
  // 1. Look up mentor by email
  const [mentor] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, mentorEmail))
    .limit(1);

  if (!mentor) {
    return { error: 'not_found' as const };
  }

  // 2. Check for existing pending or active grant for this applicant/mentor pair
  const [existing] = await db
    .select({ id: mentorGrants.id })
    .from(mentorGrants)
    .where(
      and(
        eq(mentorGrants.applicantUserId, applicantUserId),
        eq(mentorGrants.mentorUserId, mentor.id),
        or(
          eq(mentorGrants.status, 'pending'),
          eq(mentorGrants.status, 'active'),
        ),
      ),
    )
    .limit(1);

  if (existing) {
    return { error: 'conflict' as const };
  }

  // 3. Insert pending grant
  // applicant-initiated requests default to read access; the approving admin
  // may broaden to `write` via a subsequent PATCH.
  const [grant] = await db
    .insert(mentorGrants)
    .values({
      id: randomUUID(),
      applicantUserId,
      mentorUserId: mentor.id,
      permissions: ['read'],
      grantedByUserId: applicantUserId, // applicant-initiated; no admin actor yet
      status: 'pending',
      requestedByUserId: applicantUserId,
    })
    .returning();

  return { grant };
}

export async function updateMentorGrant(
  id: string,
  patch: { status?: 'active' | 'revoked'; permissions?: string[] },
) {
  const [grant] = await db
    .update(mentorGrants)
    .set(patch)
    .where(eq(mentorGrants.id, id))
    .returning();
  return grant ?? null; // null if no row matched
}
