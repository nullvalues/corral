import { db } from '../db/index.js';
import { adminActionLog } from '../db/schema/index.js';

export interface AdminActionLogOpts {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
}

/** Append-only insert into admin_action_log. Never UPDATE or DELETE this table (ADR-021 precedent). */
export async function insertAdminActionLog(opts: AdminActionLogOpts): Promise<void> {
  await db.insert(adminActionLog).values({
    actorUserId: opts.actorUserId,
    action: opts.action,
    resourceType: opts.resourceType,
    resourceId: opts.resourceId,
    before: opts.before ?? null,
    after: opts.after ?? null,
  });
}
