/**
 * Derives a mentor's level from their lifetime verified hours.
 *
 * These thresholds are the single source of truth for the mentor level (D6,
 * "thresholds in code"). All badge and level-card logic must read from these
 * named constants — no inline literals.
 *
 *   Platinum — platinumHours+ lifetime hours (default 1000, operator-configurable via readiness_config)
 *   Gold     — below platinumHours lifetime hours
 */

/** Default Platinum threshold — backward-compat constant. Use the platinumHours param where available. */
export const PLATINUM_HOURS = 1000;

export function mentorLevel(lifetimeHours: number, platinumHours = 1000): 'Gold' | 'Platinum' {
  return lifetimeHours >= platinumHours ? 'Platinum' : 'Gold';
}

/**
 * Returns the number of hours remaining until the mentor reaches Platinum,
 * or null if the mentor is already at or above Platinum.
 */
export function hoursToNextLevel(lifetimeHours: number, platinumHours = 1000): number | null {
  if (lifetimeHours >= platinumHours) return null;
  return Math.max(0, platinumHours - lifetimeHours);
}
