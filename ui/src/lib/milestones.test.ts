import { describe, it, expect } from 'vitest';
import { evaluateMilestones, type MilestoneCtx } from './milestones.js';

const base: MilestoneCtx = {
  totalHours: 0,
  experienceCount: 0,
  verifiedCount: 0,
  goalCategoriesMet: 0,
  goalCategoriesTotal: 0,
  categoriesWithExperience: 0,
};

function byKey(ctx: MilestoneCtx) {
  return new Map(evaluateMilestones(ctx).map((m) => [m.key, m]));
}

describe('evaluateMilestones', () => {
  it('empty ctx: every milestone locked, all-verified/all-goals not vacuously earned', () => {
    const m = byKey(base);
    for (const result of m.values()) {
      expect(result.earned).toBe(false);
    }
    expect(m.get('all-verified')!.earned).toBe(false);
    expect(m.get('goal-all')!.earned).toBe(false);
    expect(m.get('first-experience')!.remainingLabel).toBe('1 to go');
  });

  it('does not mirror hour-threshold milestones (API-064 — sourced from the API)', () => {
    // Hour milestones are operator-configured server-side and arrive fully
    // evaluated via GET /api/me/milestones. The client no longer re-derives them.
    const m = byKey({ ...base, totalHours: 250 });
    expect(m.has('hours-100')).toBe(false);
    expect(m.has('hours-500')).toBe(false);
    expect(m.has('hours-1000')).toBe(false);
    expect([...m.keys()]).toEqual([
      'first-experience',
      'first-verified',
      'all-verified',
      'goal-1',
      'goal-2',
      'goal-all',
      'breadth-3',
    ]);
  });

  it('all-verified earned when verified === experiences and >0', () => {
    const earned = byKey({ ...base, experienceCount: 3, verifiedCount: 3 });
    expect(earned.get('all-verified')!.earned).toBe(true);
    expect(earned.get('all-verified')!.remainingLabel).toBeNull();

    const locked = byKey({ ...base, experienceCount: 3, verifiedCount: 2 });
    expect(locked.get('all-verified')!.earned).toBe(false);
    expect(locked.get('all-verified')!.remainingLabel).toBe('1 to go');
  });

  it('goal-all earned only when total > 0 and met === total', () => {
    const earned = byKey({ ...base, goalCategoriesMet: 4, goalCategoriesTotal: 4 });
    expect(earned.get('goal-all')!.earned).toBe(true);

    const locked = byKey({ ...base, goalCategoriesMet: 0, goalCategoriesTotal: 0 });
    expect(locked.get('goal-all')!.earned).toBe(false);
  });

  it('breadth-3 earned when categoriesWithExperience >= 3', () => {
    const m = byKey({ ...base, categoriesWithExperience: 3 });
    expect(m.get('breadth-3')!.earned).toBe(true);
  });
});
