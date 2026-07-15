import { goalFraction } from './goals.js';

export interface ReadinessWeights {
  wGoal: number;
  wVerified: number;
  wBreadth: number;
}

export const DEFAULT_READINESS_WEIGHTS: ReadinessWeights = {
  wGoal: 0.6,
  wVerified: 0.25,
  wBreadth: 0.15,
};

export interface ReadinessInput {
  rollup: { categoryId: string; categorySlug: string; totalHours: number }[];
  experiences: { categoryId: string; verificationStatus: 'unverified' | 'verified' }[];
  activeCategories: { id: string; goalHours: number | null }[];
}

// PM036 seam: pass operator-configured weights here; defaults are code constants.
export function computeReadiness(
  input: ReadinessInput,
  weights = DEFAULT_READINESS_WEIGHTS,
): number {
  const { rollup, experiences, activeCategories } = input;
  const hoursByCat = new Map(rollup.map((r) => [r.categoryId, r.totalHours]));

  // goalProgress: mean over active categories that have a (non-null) goalHours.
  // goalHours is read directly off each category object (operator-editable,
  // API-041) — no longer via the legacy slug→threshold map.
  const goalBearing = activeCategories.filter((c) => c.goalHours !== null);
  const goalProgress =
    goalBearing.length === 0
      ? 0
      : goalBearing.reduce((sum, c) => {
          const hrs = hoursByCat.get(c.id) ?? 0;
          return sum + (goalFraction(c.goalHours, hrs) ?? 0);
        }, 0) / goalBearing.length;

  const verifiedCount = experiences.filter((e) => e.verificationStatus === 'verified').length;
  const verifiedRatio = verifiedCount / Math.max(1, experiences.length);

  const populated = activeCategories.filter((c) =>
    experiences.some((e) => e.categoryId === c.id),
  ).length;
  const breadth = populated / Math.max(1, activeCategories.length);

  const score =
    weights.wGoal * goalProgress +
    weights.wVerified * verifiedRatio +
    weights.wBreadth * breadth;
  return Math.round(100 * score);
}
