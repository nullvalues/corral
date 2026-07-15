import { db } from '../db/index.js';
import { users } from '../db/schema/auth.js';
import { systemRoles } from '../db/schema/roles.js';
import { like, count, eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { insertAdminActionLog } from './adminActionLog.js';
import { coerceCount } from '../db/aggregates.js';

/**
 * Returns the user's id, email, and name if the user exists, or null if not found.
 * Used for existence-checking and notification addressing (API-052, API-061).
 */
export async function getUserById(userId: string): Promise<{ id: string; email: string; name: string } | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export const escapeLike = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

export async function searchUsersByEmail(emailQuery: string) {
  return db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(like(users.email, `${escapeLike(emailQuery)}%`));
}

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  roles: string[];
  activeMentorGrantCount: number;
}

export interface UserListResult {
  users: UserListItem[];
  totalCount: number;
}

export async function listUsers(
  page: number,
  pageSize: number,
): Promise<UserListResult> {
  const offset = (page - 1) * pageSize;

  // Get total count of users
  const [countRow] = await db.select({ total: count() }).from(users);
  const totalCount = coerceCount(countRow?.total);

  // Get paginated users with roles and active mentor grant counts
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: systemRoles.role,
      activeMentorGrantCount: sql<string>`(
        SELECT COUNT(*)::int
        FROM mentor_grants mg
        WHERE mg.applicant_user_id = ${users.id}
          AND mg.status = 'active'
      )`,
    })
    .from(users)
    .leftJoin(systemRoles, eq(users.id, systemRoles.userId))
    .orderBy(users.email)
    .limit(pageSize)
    .offset(offset);

  // Aggregate roles per user (left join can produce multiple rows per user)
  const userMap = new Map<string, UserListItem>();
  for (const row of rows) {
    if (!userMap.has(row.id)) {
      userMap.set(row.id, {
        id: row.id,
        email: row.email,
        name: row.name,
        roles: [],
        activeMentorGrantCount: coerceCount(row.activeMentorGrantCount),
      });
    }
    const item = userMap.get(row.id)!;
    if (row.role !== null) {
      item.roles.push(row.role);
    }
  }

  return {
    users: Array.from(userMap.values()),
    totalCount,
  };
}

/**
 * Returns all system roles for a given user.
 */
export async function getUserRoles(userId: string): Promise<string[]> {
  const rows = await db
    .select({ role: systemRoles.role })
    .from(systemRoles)
    .where(eq(systemRoles.userId, userId));
  return rows.map((r) => r.role);
}

/**
 * Grant or revoke the 'admin' role for a target user.
 * Guards:
 *   - target user must exist (404)
 *   - actor cannot self-demote (403)
 *   - cannot revoke the last admin (409) — checked inside a transaction to prevent TOCTOU
 * Writes an admin_action_log row for auditability (awaited).
 */
export async function setAdminRole(
  actorId: string,
  targetUserId: string,
  action: 'grant' | 'revoke',
): Promise<void> {
  // CER-026: verify target user exists before any mutation
  const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId));
  if (!targetUser) {
    const err = new Error('User not found');
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }

  if (actorId === targetUserId) {
    const err = new Error('Cannot modify your own admin role');
    (err as Error & { statusCode: number }).statusCode = 403;
    throw err;
  }

  if (action === 'revoke') {
    // CER-025: wrap count check + delete in a transaction to prevent TOCTOU race
    await db.transaction(async (tx) => {
      const [countRow] = await tx
        .select({ total: count() })
        .from(systemRoles)
        .where(eq(systemRoles.role, 'admin'));
      const adminCount = coerceCount(countRow?.total);
      if (adminCount <= 1) {
        const err = new Error('Cannot remove the last admin');
        (err as Error & { statusCode: number }).statusCode = 409;
        throw err;
      }
      // Delete the admin role row (no-op if absent)
      await tx
        .delete(systemRoles)
        .where(and(eq(systemRoles.userId, targetUserId), eq(systemRoles.role, 'admin')));
    });

    // CER-027: await audit log; capture before-state on revoke
    await insertAdminActionLog({
      actorUserId: actorId,
      action: 'role_change',
      resourceType: 'system_role',
      resourceId: targetUserId,
      before: { role: 'admin' },
      after: { role: 'admin', action },
    });
  } else {
    // Grant: upsert admin role
    await db
      .insert(systemRoles)
      .values({ userId: targetUserId, role: 'admin' })
      .onConflictDoNothing();

    // CER-027: await audit log; no before-state on grant
    await insertAdminActionLog({
      actorUserId: actorId,
      action: 'role_change',
      resourceType: 'system_role',
      resourceId: targetUserId,
      after: { role: 'admin', action },
    });
  }
}
