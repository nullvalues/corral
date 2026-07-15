// app-owned table: flag_report (DB-033, Phase PM048-main) — reviewer-private.
// One row per (reviewer, experience) pair: a reviewer's escalation flag on a
// specific experience. reviewerUserId / resolvedByUserId reference users.id
// conceptually only — NO Drizzle references() per ADR-003 (BA owns identity);
// experienceId is likewise a soft ref to experiences.id. Reviewer writes via
// POST /api/experiences/:id/flag (API-059); admin read/resolve paths and the
// open → resolved PATCH are also API-059. Management surface: admin flag
// review view (UI-101).
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const flagReport = pgTable(
  'flag_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewerUserId: text('reviewer_user_id').notNull(),
    experienceId: uuid('experience_id').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    resolvedByUserId: text('resolved_by_user_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // ADR-026: 255-char CHECKs on BA-identity soft references.
    check('flag_report_reviewer_len', sql`char_length(${t.reviewerUserId}) <= 255`),
    check('flag_report_reason_len', sql`char_length(${t.reason}) <= 1024`),
    check('flag_report_status_values', sql`${t.status} IN ('open', 'resolved')`),
    check(
      'flag_report_resolved_by_len',
      sql`${t.resolvedByUserId} IS NULL OR char_length(${t.resolvedByUserId}) <= 255`,
    ),
    index('flag_report_experience_idx').on(t.experienceId),
    index('flag_report_reviewer_idx').on(t.reviewerUserId),
  ],
);
