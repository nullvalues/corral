// app-owned tables: system_roles, mentor_grants — no Drizzle FK to users per ADR-003 / ADR-007, ADR-008.
import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const systemRoles = pgTable(
  'system_roles',
  {
    userId: text('user_id').notNull(),
    role: text('role').notNull(), // 'admin' | 'applicant'
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.role] }),
    check('system_roles_role_values', sql`${t.role} IN ('admin', 'applicant')`),
    // DB-018 / CER-011: 255-char CHECK on BA-identity soft reference. See ADR-026.
    check('system_roles_user_id_len', sql`char_length(${t.userId}) <= 255`),
  ],
);

// DB-029 / ADR-042: A partial unique index (mentor_grants_active_pair_uq) enforces
// at-most-one active grant per (mentor_user_id, applicant_user_id) pair at the database
// level. The index is defined in raw SQL migration 0025_mentor_grants_active_pair_uq.sql
// because Drizzle's schema DSL does not support partial indexes. Revoked/historical
// grants for the same pair are not subject to the constraint (WHERE status = 'active').
export const mentorGrants = pgTable(
  'mentor_grants',
  {
    id: text('id').primaryKey(),
    applicantUserId: text('applicant_user_id').notNull(),
    mentorUserId: text('mentor_user_id').notNull(),
    grantedAt: timestamp('granted_at', { mode: 'date' }).notNull().defaultNow(),
    grantedByUserId: text('granted_by_user_id').notNull(),
    status: text('status').notNull().default('active'), // 'pending' | 'active' | 'revoked'
    // DB-031 / ADR-044: closed vocabulary — only 'read' and 'write' are valid values.
    // A database CHECK (permissions <@ ARRAY['read','write']::text[]) is defined in
    // raw SQL migration 0027_mentor_grants_permissions_check.sql and is NOT expressed
    // in the Drizzle schema DSL (array-containment CHECKs are unsupported). The Zod
    // route boundary (mentor-grants.ts PermissionsSchema) enforces the same constraint
    // with a user-readable 400 before the DB is reached.
    permissions: text('permissions').array().notNull().default([]),
    // DB-020: NULL = admin-created grant; non-null = applicant-initiated request.
    requestedByUserId: text('requested_by_user_id'),
  },
  (t) => [
    check('mentor_grants_status_values', sql`${t.status} IN ('pending', 'active', 'revoked')`),
    // DB-018 / CER-011: 255-char CHECKs on BA-identity soft references. See ADR-026.
    check('mentor_grants_mentor_user_id_len', sql`char_length(${t.mentorUserId}) <= 255`),
    check('mentor_grants_applicant_user_id_len', sql`char_length(${t.applicantUserId}) <= 255`),
    check('mentor_grants_granted_by_user_id_len', sql`char_length(${t.grantedByUserId}) <= 255`),
    // DB-020: 255-char CHECK on nullable BA-identity soft reference. See ADR-026. DB-023: char_length (not length) per CER-032.
    check('mentor_grants_requested_by_user_id_len', sql`char_length(${t.requestedByUserId}) <= 255`),
  ],
);
