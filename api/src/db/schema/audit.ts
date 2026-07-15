// app-owned table: pii_access_log (DB-016, Phase 5) — append-only audit log.
// Records who read or changed contact PII on an experience.
// See ADR-021: append-only; no management UI required; Phase 6 write path via API-015.
// actorUserId references users.id conceptually only — no Drizzle references() per ADR-003 (BA owns identity).
//
// app-owned table: admin_action_log (DB-019, Phase 10) — append-only audit log.
// Records admin-level write actions (mentor grant create/update, category create/update).
// See CER-013: closes the admin-action audit gap. API-025 wires the write helper into routes.
// actorUserId references users.id conceptually only — no Drizzle references() per ADR-003 (BA owns identity).
// Append-only — qualifies for the management-surface exception (see ADR-021 precedent).
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const piiAccessLog = pgTable(
  'pii_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id').notNull(),
    action: text('action').notNull(), // 'read' | 'create' | 'update' | 'delete'
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    subjectUserId: text('subject_user_id'),
    viaGrant: boolean('via_grant').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('pii_access_log_action_values', sql`${t.action} IN ('read','create','update','delete')`),
    check('pii_access_log_actor_len', sql`char_length(${t.actorUserId}) <= 255`),
    check('pii_access_log_resource_type_len', sql`char_length(${t.resourceType}) <= 64`),
    check('pii_access_log_subject_len', sql`${t.subjectUserId} IS NULL OR char_length(${t.subjectUserId}) <= 255`),
    index('pii_access_log_subject_idx').on(t.subjectUserId),
  ],
);

export const adminActionLog = pgTable(
  'admin_action_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('admin_action_log_actor_len', sql`char_length(${t.actorUserId}) <= 255`),
    check('admin_action_log_action_len', sql`char_length(${t.action}) <= 64`),
    check(
      'admin_action_log_action_values',
      sql`${t.action} IN ('grant_create','grant_update','grant_review','category_create','category_update','category_delete','role_change')`,
    ),
    check('admin_action_log_resource_type_len', sql`char_length(${t.resourceType}) <= 64`),
    check('admin_action_log_resource_id_len', sql`char_length(${t.resourceId}) <= 255`),
  ],
);
