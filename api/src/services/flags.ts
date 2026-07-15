// Service: flag_report reads/writes (API-059).
//
// createFlag persists a reviewer's escalation flag on an experience. The route
// gates the write with hasMentorGrant (ABAC) — this service is unconditional
// persistence only, mirroring interview-shortlist.ts.
//
// listFlags is the admin read path: flag rows joined with the flagged
// experience (organization, position, ownerUserId) and the reviewer who raised
// the flag (name, email). LEFT JOINs — a flag whose experience or reviewer row
// has since been deleted still surfaces (joined fields null) rather than
// silently disappearing from the admin queue.
//
// resolveFlag performs the open → resolved transition, recording the resolving
// admin and timestamp. Resolving an already-resolved flag is idempotent — the
// existing resolved row is returned unchanged.
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { experiences, flagReport, users } from '../db/schema/index.js';

export async function createFlag(reviewerUserId: string, experienceId: string, reason: string) {
  const [row] = await db
    .insert(flagReport)
    .values({ reviewerUserId, experienceId, reason, status: 'open' })
    .returning();
  return row;
}

export type ListFlagsOpts = {
  status?: 'open' | 'resolved';
  limit?: number;
  offset?: number;
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function listFlags(opts: ListFlagsOpts = {}) {
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = opts.offset ?? 0;

  const base = db
    .select({
      id: flagReport.id,
      reviewerUserId: flagReport.reviewerUserId,
      experienceId: flagReport.experienceId,
      reason: flagReport.reason,
      status: flagReport.status,
      resolvedByUserId: flagReport.resolvedByUserId,
      resolvedAt: flagReport.resolvedAt,
      createdAt: flagReport.createdAt,
      organization: experiences.organization,
      position: experiences.position,
      ownerUserId: experiences.ownerUserId,
      reviewerName: users.name,
      reviewerEmail: users.email,
    })
    .from(flagReport)
    .leftJoin(experiences, eq(flagReport.experienceId, experiences.id))
    .leftJoin(users, eq(flagReport.reviewerUserId, users.id));

  const filtered = opts.status ? base.where(eq(flagReport.status, opts.status)) : base;

  return filtered.orderBy(desc(flagReport.createdAt)).limit(limit).offset(offset);
}

export async function resolveFlag(flagId: string, resolvedByUserId: string) {
  const [updated] = await db
    .update(flagReport)
    .set({ status: 'resolved', resolvedByUserId, resolvedAt: new Date() })
    .where(and(eq(flagReport.id, flagId), eq(flagReport.status, 'open')))
    .returning();
  if (updated) return updated;

  // No open row matched — either the flag does not exist (null → route 404)
  // or it is already resolved (idempotent: return the existing row unchanged).
  const [existing] = await db.select().from(flagReport).where(eq(flagReport.id, flagId)).limit(1);
  return existing ?? null;
}
