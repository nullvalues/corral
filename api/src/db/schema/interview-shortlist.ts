// app-owned table: interview_shortlist (DB-026, Phase PM037) — reviewer-owned.
// One row per (reviewer, applicant) pair. reviewerUserId / applicantUserId
// reference users.id conceptually only — NO Drizzle references() per ADR-003
// (BA owns identity). Reviewer-private: reads are isolated to reviewer_user_id =
// caller (API-043 left-join), writes are gated by hasMentorGrant (API-044). See ADR-033.
import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const interviewShortlist = pgTable(
  'interview_shortlist',
  {
    reviewerUserId: text('reviewer_user_id').notNull(),
    applicantUserId: text('applicant_user_id').notNull(),
    starRating: integer('star_rating'),
    shortlisted: boolean('shortlisted').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.reviewerUserId, t.applicantUserId] }),
    check(
      'interview_shortlist_star_rating_bounds',
      sql`${t.starRating} IS NULL OR (${t.starRating} >= 0 AND ${t.starRating} <= 5)`,
    ),
    // DB-018 / CER-011 / ADR-026: 255-char CHECKs on BA-identity soft references.
    check('interview_shortlist_reviewer_user_id_len', sql`char_length(${t.reviewerUserId}) <= 255`),
    check('interview_shortlist_applicant_user_id_len', sql`char_length(${t.applicantUserId}) <= 255`),
  ],
);
