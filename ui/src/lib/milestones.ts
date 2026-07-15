/**
 * Structural milestone display metadata (PM034 dashboard, Decision 3).
 *
 * ADR-041 SUPERSESSION (API-064, PM052-main): this module NO LONGER mirrors the
 * hour-threshold milestone definitions. Hour milestones (hours-100, hours-500,
 * hours-1000, …) are operator-configurable rows in the server's `milestone_config`
 * table; the client receives the complete, fully-evaluated milestone list
 * (structural + configured hour milestones) from `GET /api/me/milestones`
 * (`useMyMilestones`) and displays it directly. It does NOT re-derive hour
 * milestones locally.
 *
 * What remains here is the STRUCTURAL milestone display metadata + the pure
 * `evaluateMilestones()` helper for structural predicates (first-experience,
 * first-verified, all-verified, goal-1/2/all, breadth-3) — the milestones whose
 * earned state cannot be reduced to a single stored hour threshold. The
 * authoritative earned/not-earned state for ALL milestones (including these
 * structural ones) still comes from the API response; this local evaluation is
 * retained only as display metadata / types. Every milestone's `earned` flag is
 * a deterministic pure predicate over `MilestoneCtx`.
 */

export interface MilestoneCtx {
  totalHours: number;
  experienceCount: number;
  verifiedCount: number;
  goalCategoriesMet: number;
  goalCategoriesTotal: number;
  categoriesWithExperience: number;
}

export interface MilestoneResult {
  key: string;
  label: string;
  earned: boolean;
  remainingLabel: string | null;
}

interface MilestoneDef {
  key: string;
  label: string;
  earned: (c: MilestoneCtx) => boolean;
  remaining: (c: MilestoneCtx) => string | null; // shown only while locked
}

// STRUCTURAL milestones only (API-064). Hour-threshold milestones are NOT
// mirrored here — they are operator-configured server-side and arrive fully
// evaluated via GET /api/me/milestones. Do not re-add a hardcoded hours-* mirror.
export const MILESTONES: MilestoneDef[] = [
  {
    key: 'first-experience',
    label: 'First experience',
    earned: (c) => c.experienceCount >= 1,
    remaining: () => '1 to go',
  },
  {
    key: 'first-verified',
    label: 'First verified',
    earned: (c) => c.verifiedCount >= 1,
    remaining: () => '1 to go',
  },
  {
    key: 'all-verified',
    label: 'All verified',
    earned: (c) => c.experienceCount > 0 && c.verifiedCount === c.experienceCount,
    remaining: (c) => `${Math.max(0, c.experienceCount - c.verifiedCount)} to go`,
  },
  {
    key: 'goal-1',
    label: '1 goal met',
    earned: (c) => c.goalCategoriesMet >= 1,
    remaining: () => '1 to go',
  },
  {
    key: 'goal-2',
    label: '2 goals met',
    earned: (c) => c.goalCategoriesMet >= 2,
    remaining: (c) => `${Math.max(0, 2 - c.goalCategoriesMet)} to go`,
  },
  {
    key: 'goal-all',
    label: 'All goals met',
    earned: (c) => c.goalCategoriesTotal > 0 && c.goalCategoriesMet === c.goalCategoriesTotal,
    remaining: (c) => `${Math.max(0, c.goalCategoriesTotal - c.goalCategoriesMet)} to go`,
  },
  {
    key: 'breadth-3',
    label: '3 categories',
    earned: (c) => c.categoriesWithExperience >= 3,
    remaining: (c) => `${Math.max(0, 3 - c.categoriesWithExperience)} to go`,
  },
];

export function evaluateMilestones(ctx: MilestoneCtx): MilestoneResult[] {
  return MILESTONES.map((m) => {
    const earned = m.earned(ctx);
    return { key: m.key, label: m.label, earned, remainingLabel: earned ? null : m.remaining(ctx) };
  });
}
