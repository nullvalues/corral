import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { piiAccessLog } from '../db/schema/index.js';

export interface PiiAccessLogOpts {
  actorUserId: string;
  action: 'read' | 'create' | 'update' | 'delete';
  resourceType: string;
  resourceId?: string | null;
  subjectUserId?: string;
  viaGrant?: boolean;
}

export interface ListPiiAccessLogOpts {
  mentorUserId?: string;
  applicantUserId?: string;
  limit?: number;
}

export interface PiiAccessLogRow {
  id: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  subjectUserId: string | null;
  viaGrant: boolean;
  createdAt: Date;
}

/** Append-only insert into pii_access_log. Never UPDATE or DELETE this table (ADR-021). */
export function insertPiiAccessLog(opts: PiiAccessLogOpts): void {
  db.insert(piiAccessLog)
    .values({
      actorUserId: opts.actorUserId,
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      subjectUserId: opts.subjectUserId,
      viaGrant: opts.viaGrant ?? false,
    })
    .catch((err: unknown) => {
      console.error(JSON.stringify({
        event: 'pii_access_log_write_failed',
        actorUserId: opts.actorUserId,
        action: opts.action,
        resourceType: opts.resourceType,
        resourceId: opts.resourceId ?? null,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      }));
    });
}

/** Read-only list with optional mentorUserId/applicantUserId filters. Ordered by createdAt DESC. */
export async function listPiiAccessLog(opts: ListPiiAccessLogOpts): Promise<PiiAccessLogRow[]> {
  const limit = Math.min(opts.limit ?? 100, 200);

  const conditions = [];
  if (opts.mentorUserId) {
    conditions.push(eq(piiAccessLog.actorUserId, opts.mentorUserId));
  }
  if (opts.applicantUserId) {
    conditions.push(eq(piiAccessLog.subjectUserId, opts.applicantUserId));
  }

  const rows = await db
    .select()
    .from(piiAccessLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(piiAccessLog.createdAt))
    .limit(limit);

  return rows;
}
