// app-owned table: milestone_award (DB-027, Phase PM038-main).
// Stored earned-state for the canonical milestone set (Decision 3). One row per
// (user_id, milestone_key); UNIQUE pair is the idempotency key for the award
// worker (API-045, ON CONFLICT DO NOTHING). userId references users.id
// conceptually only — no Drizzle references() per ADR-003 (BA owns identity).
// Management surface: admin milestone-award audit view (UI-081) + auto-award
// worker as system writer (API-045). See ADR-041 (ADR-034).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const milestoneAward = pgTable(
  'milestone_award',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    milestoneKey: text('milestone_key').notNull(),
    earnedAt: timestamp('earned_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('milestone_award_user_key_uq').on(t.userId, t.milestoneKey),
    check('milestone_award_user_id_len', sql`char_length(${t.userId}) <= 255`),
    check('milestone_award_key_len', sql`char_length(${t.milestoneKey}) <= 64`),
    index('milestone_award_user_idx').on(t.userId),
  ],
);

// app-owned table: milestone_config (API-064, Phase PM052-main).
//
// Operator-configurable hour-threshold milestone definitions. Each row is one
// hour milestone (key like 'hours-100') that an admin can relabel, re-threshold,
// deactivate, or reorder WITHOUT a code deploy — superseding the ADR-041
// server↔client lock-step mirror for hour milestones (the client now receives
// fully-evaluated results from GET /api/me/milestones instead of re-deriving).
//
// Structural milestones (first-experience, all-verified, goal-*) remain code-
// defined in api/src/services/milestones.ts because their predicates cannot be
// expressed as a single hour threshold.
//
// Bounds are enforced at BOTH the route (Zod) and DB (CHECK) layers per the
// project ideology: `key` ≤ 64 chars (matches milestone_award_key_len so a
// configured key can always be stored as an award), `label` ≤ 128 chars, and
// threshold_hours must be a positive integer.
//
// Management surface: GET/PUT /api/admin/milestone-config (admin-gated).
export const milestoneConfig = pgTable(
  'milestone_config',
  {
    key: text('key').primaryKey(),
    label: text('label').notNull(),
    thresholdHours: integer('threshold_hours').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    check('milestone_config_key_len', sql`char_length(${t.key}) <= 64`),
    check('milestone_config_label_len', sql`char_length(${t.label}) <= 128`),
    check('milestone_config_threshold_hours_pos', sql`${t.thresholdHours} > 0`),
  ],
);
