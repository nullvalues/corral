/**
 * Goal-hours derivation. As of PM036 (UI-077) the goal value is the
 * operator-editable `experience_categories.goal_hours` column (API-041),
 * surfaced on each fetched category as `goalHours: number | null`. The goal
 * helpers below therefore take that value directly — they are NOT keyed off the
 * legacy slug→threshold map any more.
 *
 * `null` = "no hour minimum for this category" (distinct from a 0-hour goal); a
 * `null` goal excludes the category from goal-bearing aggregates.
 */

/**
 * Legacy per-category hour GOALS, keyed by category slug. Retained as the
 * display source for RisingCandidatesCard's talent-pool readiness computation,
 * which maps category slugs to goal hours (the talent-pool API response carries
 * no goalHours field). The readiness/goals derivation path no longer reads this
 * map for owned-applicant views — it reads each category's `goalHours` value
 * instead.
 *
 * Fail-open: an unknown slug has no goal (null).
 */
export const GOAL_HOURS: Record<string, number | null> = {
  'patient-care-experience': 1000,
  'healthcare-experience': 500,
  'volunteer-experience': 300,
  'research-experience': 300,
  'employment': null,
  'extracurricular-activities': null,
};

/** Legacy slug→goal lookup; consumed by RisingCandidatesCard's talent-pool readiness map. */
export function goalForSlug(slug: string): number | null {
  return GOAL_HOURS[slug] ?? null;
}

export function goalMet(goal: number | null, hours: number): boolean {
  return goal !== null && hours >= goal;
}

export function goalPercent(goal: number | null, hours: number): number | null {
  if (goal === null || goal <= 0) return null;
  return Math.min(100, Math.round((hours / goal) * 100));
}

export function exceededBy(goal: number | null, hours: number): number | null {
  if (goal === null) return null;
  return hours > goal ? hours - goal : null;
}

/**
 * Per-category contribution to readiness `goalProgress`: `min(1, hours/goal)`
 * for a goal-bearing category, or `null` when the category has no goal (and is
 * therefore excluded from the goalProgress mean).
 */
export function goalFraction(goal: number | null, hours: number): number | null {
  if (goal === null || goal <= 0) return null;
  return Math.min(1, hours / goal);
}
