// app-owned table: readiness_config (DB-025, PM036) — single-row operator config
// for the client-computed readiness formula weights (D1). No Drizzle FK.
// Single-row enforced via CHECK (id = 'default'); see ADR-032.
// platinumHours added API-063 (PM052-main): operator-configurable Platinum mentor threshold.
import { sql } from 'drizzle-orm';
import { check, doublePrecision, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const readinessConfig = pgTable(
  'readiness_config',
  {
    id: text('id').primaryKey().default('default'),
    wGoal: doublePrecision('w_goal').notNull().default(0.6),
    wVerified: doublePrecision('w_verified').notNull().default(0.25),
    wBreadth: doublePrecision('w_breadth').notNull().default(0.15),
    platinumHours: integer('platinum_hours').notNull().default(1000),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('readiness_config_singleton', sql`${t.id} = 'default'`),
    check('readiness_config_w_goal_bounds', sql`${t.wGoal} >= 0 AND ${t.wGoal} <= 1`),
    check('readiness_config_w_verified_bounds', sql`${t.wVerified} >= 0 AND ${t.wVerified} <= 1`),
    check('readiness_config_w_breadth_bounds', sql`${t.wBreadth} >= 0 AND ${t.wBreadth} <= 1`),
    check('readiness_config_platinum_hours_pos', sql`${t.platinumHours} > 0`),
  ],
);
