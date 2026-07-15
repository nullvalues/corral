import { describe, it, expect } from 'vitest';
import {
  computeReadiness,
  DEFAULT_READINESS_WEIGHTS,
  type ReadinessInput,
} from './readiness.js';

describe('computeReadiness', () => {
  it('returns 0 with zero experiences', () => {
    const input: ReadinessInput = {
      rollup: [],
      experiences: [],
      activeCategories: [
        { id: 'c1', goalHours: 500 },
        { id: 'c2', goalHours: null },
      ],
    };
    expect(computeReadiness(input)).toBe(0);
  });

  it('computes the hand-checked mixed case to 50', () => {
    // One active goal-bearing category (healthcare-experience, goal 500) at 250 hrs
    //   → goalProgress = 0.5
    // 1 of 2 experiences verified → verifiedRatio = 0.5
    // 1 of 2 active categories populated → breadth = 0.5
    // round(100 × (0.6·0.5 + 0.25·0.5 + 0.15·0.5)) = round(100 × 0.5) = 50
    const input: ReadinessInput = {
      rollup: [{ categoryId: 'c1', categorySlug: 'healthcare-experience', totalHours: 250 }],
      experiences: [
        { categoryId: 'c1', verificationStatus: 'verified' },
        { categoryId: 'c1', verificationStatus: 'unverified' },
      ],
      activeCategories: [
        { id: 'c1', goalHours: 500 },
        { id: 'c2', goalHours: null },
      ],
    };
    expect(computeReadiness(input)).toBe(50);
  });

  it('returns 100 for a fully complete portfolio', () => {
    const input: ReadinessInput = {
      rollup: [
        { categoryId: 'c1', categorySlug: 'healthcare-experience', totalHours: 500 },
        { categoryId: 'c2', categorySlug: 'volunteer-experience', totalHours: 300 },
      ],
      experiences: [
        { categoryId: 'c1', verificationStatus: 'verified' },
        { categoryId: 'c2', verificationStatus: 'verified' },
      ],
      activeCategories: [
        { id: 'c1', goalHours: 500 },
        { id: 'c2', goalHours: 300 },
      ],
    };
    expect(computeReadiness(input)).toBe(100);
  });

  it('excludes no-goal categories from goalProgress', () => {
    // employment has a null goal → does not contribute to the goal-bearing set.
    // Only healthcare-experience (goal 500) at 500 hrs counts → goalProgress = 1.
    // Both experiences verified → verifiedRatio = 1.
    // Both active categories populated → breadth = 1.
    // → 100 despite employment having no hours.
    const input: ReadinessInput = {
      rollup: [{ categoryId: 'c1', categorySlug: 'healthcare-experience', totalHours: 500 }],
      experiences: [
        { categoryId: 'c1', verificationStatus: 'verified' },
        { categoryId: 'c2', verificationStatus: 'verified' },
      ],
      activeCategories: [
        { id: 'c1', goalHours: 500 },
        { id: 'c2', goalHours: null },
      ],
    };
    expect(computeReadiness(input)).toBe(100);
  });

  it('honours custom weights overriding the default split', () => {
    // goalProgress = 0.5 (250/500); with {wGoal:1,wVerified:0,wBreadth:0}
    // result = round(100 × goalProgress) = 50, independent of verified/breadth.
    const input: ReadinessInput = {
      rollup: [{ categoryId: 'c1', categorySlug: 'healthcare-experience', totalHours: 250 }],
      experiences: [{ categoryId: 'c1', verificationStatus: 'unverified' }],
      activeCategories: [{ id: 'c1', goalHours: 500 }],
    };
    expect(computeReadiness(input, { wGoal: 1, wVerified: 0, wBreadth: 0 })).toBe(50);
  });

  it('exposes the default weights as the PM036 config seam', () => {
    expect(DEFAULT_READINESS_WEIGHTS).toEqual({ wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15 });
  });

  it('no-weights and explicit DEFAULT_READINESS_WEIGHTS produce the same number (parity)', () => {
    const input: ReadinessInput = {
      rollup: [{ categoryId: 'c1', categorySlug: 'healthcare-experience', totalHours: 250 }],
      experiences: [
        { categoryId: 'c1', verificationStatus: 'verified' },
        { categoryId: 'c1', verificationStatus: 'unverified' },
      ],
      activeCategories: [
        { id: 'c1', goalHours: 500 },
        { id: 'c2', goalHours: null },
      ],
    };
    expect(computeReadiness(input)).toBe(computeReadiness(input, DEFAULT_READINESS_WEIGHTS));
  });

  it('applies the weights — {wGoal:1} equals round(100 × goalProgress)', () => {
    // goalProgress = min(1, 750/1000) = 0.75; other terms zeroed by weights.
    const input: ReadinessInput = {
      rollup: [{ categoryId: 'c1', categorySlug: 'patient-care-experience', totalHours: 750 }],
      experiences: [{ categoryId: 'c1', verificationStatus: 'unverified' }],
      activeCategories: [{ id: 'c1', goalHours: 1000 }],
    };
    expect(computeReadiness(input, { wGoal: 1, wVerified: 0, wBreadth: 0 })).toBe(
      Math.round(100 * 0.75),
    );
  });
});

// ---------------------------------------------------------------------------
// TEST-053: talent-pool component ranking
//
// Simulates what the client readiness calculator does when given components
// from two synthetic talent-pool entries. Proves that:
//   - the broad/all-verified applicant scores strictly higher than the
//     narrow/unverified one, and
//   - sorting by readiness descending places the broad applicant first.
//
// Broad applicant (activeCategories both goal-bearing, all hours meet goals,
// all experiences verified, both categories populated):
//   goalProgress = (min(1,600/500) + min(1,350/300)) / 2 = (1+1)/2 = 1.0
//   verifiedRatio = 3/3 = 1.0
//   breadth = 2/2 = 1.0
//   score = 0.6·1 + 0.25·1 + 0.15·1 = 1.0  → 100
//
// Narrow applicant (same two active categories but only one has experiences,
// all unverified, hours far below goal):
//   goalProgress = (min(1,50/500) + min(1,0/300)) / 2 = (0.1 + 0) / 2 = 0.05
//   verifiedRatio = 0/2 = 0
//   breadth = 1/2 = 0.5  (only cat1 is populated)
//   score = 0.6·0.05 + 0.25·0 + 0.15·0.5 = 0.03 + 0 + 0.075 = 0.105 → 11
// ---------------------------------------------------------------------------

describe('TEST-053: talent-pool component ranking (broad > narrow)', () => {
  // Broad: two goal-bearing categories, all experiences verified, goals exceeded.
  const broadInput: ReadinessInput = {
    rollup: [
      { categoryId: 'cat1', categorySlug: 'healthcare-experience', totalHours: 600 },
      { categoryId: 'cat2', categorySlug: 'patient-care-experience', totalHours: 350 },
    ],
    experiences: [
      { categoryId: 'cat1', verificationStatus: 'verified' },
      { categoryId: 'cat1', verificationStatus: 'verified' },
      { categoryId: 'cat2', verificationStatus: 'verified' },
    ],
    activeCategories: [
      { id: 'cat1', goalHours: 500 },
      { id: 'cat2', goalHours: 300 },
    ],
  };

  // Narrow: same two active categories but only cat1 has experiences (both unverified)
  // and hours are far below the goal.
  const narrowInput: ReadinessInput = {
    rollup: [{ categoryId: 'cat1', categorySlug: 'healthcare-experience', totalHours: 50 }],
    experiences: [
      { categoryId: 'cat1', verificationStatus: 'unverified' },
      { categoryId: 'cat1', verificationStatus: 'unverified' },
    ],
    activeCategories: [
      { id: 'cat1', goalHours: 500 },
      { id: 'cat2', goalHours: 300 },
    ],
  };

  it('broad/all-verified applicant scores strictly higher than narrow/unverified one', () => {
    const broadScore = computeReadiness(broadInput);
    const narrowScore = computeReadiness(narrowInput);
    expect(broadScore).toBe(100);
    expect(narrowScore).toBe(11);
    expect(broadScore).toBeGreaterThan(narrowScore);
  });

  it('sort by readiness descending places the broad applicant first', () => {
    const candidates = [
      { name: 'narrow', score: computeReadiness(narrowInput) },
      { name: 'broad', score: computeReadiness(broadInput) },
    ];
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    expect(sorted[0].name).toBe('broad');
    expect(sorted[1].name).toBe('narrow');
  });

  it('broad score uses default weights correctly (hand-verified)', () => {
    // goalProgress=1, verifiedRatio=1, breadth=1 → score=1.0 → 100
    expect(computeReadiness(broadInput, DEFAULT_READINESS_WEIGHTS)).toBe(100);
  });

  it('narrow score uses default weights correctly (hand-verified)', () => {
    // goalProgress=0.05, verifiedRatio=0, breadth=0.5 → score=0.105 → round(10.5)=11
    expect(computeReadiness(narrowInput, DEFAULT_READINESS_WEIGHTS)).toBe(11);
  });
});
