/**
 * readiness_config service (API-042, PM036).
 *
 * The single-row `readiness_config` table (id = 'default') holds the operator
 * weights for the client-computed readiness formula (DB-025). These mirror the
 * UI's DEFAULT_READINESS_WEIGHTS 1:1 (ui/src/lib/readiness.ts). The PUT write is
 * an admin action but is intentionally NOT recorded in admin_action_log — the
 * audit vocabulary CHECK (DB-022) is closed to six values; extending it is out
 * of this phase's scope (see API-042 spec, ADR-032 note).
 *
 * platinumHours added API-063 (PM052-main): operator-configurable Platinum mentor
 * threshold. Exposed on GET /api/readiness-config and accepted on PUT /api/admin/readiness-config.
 */
import { db } from '../db/index.js';
import { readinessConfig } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

const DEFAULT_ID = 'default';
const DEFAULTS = { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000 };

export type ReadinessConfigPayload = {
  wGoal: number;
  wVerified: number;
  wBreadth: number;
  platinumHours: number;
};

export async function getReadinessConfig(): Promise<ReadinessConfigPayload> {
  const [row] = await db
    .select()
    .from(readinessConfig)
    .where(eq(readinessConfig.id, DEFAULT_ID))
    .limit(1);
  if (row) {
    return {
      wGoal: row.wGoal,
      wVerified: row.wVerified,
      wBreadth: row.wBreadth,
      platinumHours: row.platinumHours,
    };
  }
  // Defensive: empty table (should not happen post-seed) — insert and return defaults.
  await db.insert(readinessConfig).values({ id: DEFAULT_ID, ...DEFAULTS }).onConflictDoNothing();
  return { ...DEFAULTS };
}

export async function updateReadinessConfig(
  weights: ReadinessConfigPayload,
): Promise<ReadinessConfigPayload> {
  const [row] = await db
    .insert(readinessConfig)
    .values({ id: DEFAULT_ID, ...weights, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: readinessConfig.id,
      set: { ...weights, updatedAt: new Date() },
    })
    .returning();
  return {
    wGoal: row.wGoal,
    wVerified: row.wVerified,
    wBreadth: row.wBreadth,
    platinumHours: row.platinumHours,
  };
}
