/**
 * TEST-052-D: readiness parity test.
 *
 * For a fixed sample input using the seeded goalHours values (patient-care-experience=1000,
 * employment=null), asserts that:
 *
 *   1. computeReadiness(input, DEFAULT_READINESS_WEIGHTS) returns the exact expected integer
 *      (hand-verified from the D1 formula — pins the contract).
 *   2. computeReadiness(input) with no explicit weights returns the same value
 *      (the PM034 code-default path and the PM036 operator-config seam are
 *      faithful re-parameterisations of each other; no drift is present).
 *
 * Expected value derivation (all hand-computed):
 *
 *   Input:
 *     activeCategories: [{ id:'pce', goalHours:1000 }, { id:'emp', goalHours:null }]
 *     rollup:           [{ categoryId:'pce', totalHours:600 }]
 *     experiences:      [{ categoryId:'pce', verificationStatus:'verified' },
 *                        { categoryId:'emp', verificationStatus:'unverified' }]
 *
 *   goalBearing:   [pce (goalHours=1000)]
 *   goalFraction:  min(1, 600/1000) = 0.6
 *   goalProgress:  0.6 / 1 = 0.6
 *
 *   verifiedCount: 1  (pce is verified)
 *   total exps:    2
 *   verifiedRatio: 0.5
 *
 *   populated:     2  (pce + emp each have at least one experience)
 *   active:        2
 *   breadth:       2/2 = 1.0
 *
 *   score = 0.6×0.6 + 0.25×0.5 + 0.15×1.0
 *         = 0.36 + 0.125 + 0.15
 *         = 0.635
 *   result = Math.round(100 × 0.635) = 64
 */

import { describe, it, expect } from 'vitest';
import { computeReadiness, DEFAULT_READINESS_WEIGHTS, type ReadinessInput } from './readiness.js';

const SAMPLE_INPUT: ReadinessInput = {
  activeCategories: [
    { id: 'pce', goalHours: 1000 }, // seeded: patient-care-experience
    { id: 'emp', goalHours: null }, // seeded: employment
  ],
  rollup: [{ categoryId: 'pce', categorySlug: 'patient-care-experience', totalHours: 600 }],
  experiences: [
    { categoryId: 'pce', verificationStatus: 'verified' },
    { categoryId: 'emp', verificationStatus: 'unverified' },
  ],
};

const EXPECTED_SCORE = 64;

describe('TEST-052-D: readiness parity — DEFAULT_READINESS_WEIGHTS vs code defaults', () => {
  it('computeReadiness with explicit DEFAULT_READINESS_WEIGHTS returns the pinned integer', () => {
    expect(computeReadiness(SAMPLE_INPUT, DEFAULT_READINESS_WEIGHTS)).toBe(EXPECTED_SCORE);
  });

  it('computeReadiness with no weights (code defaults) returns the same pinned integer', () => {
    expect(computeReadiness(SAMPLE_INPUT)).toBe(EXPECTED_SCORE);
  });

  it('explicit DEFAULT_READINESS_WEIGHTS and code defaults produce identical scores (no drift)', () => {
    const withDefault = computeReadiness(SAMPLE_INPUT);
    const withExplicit = computeReadiness(SAMPLE_INPUT, DEFAULT_READINESS_WEIGHTS);
    expect(withExplicit).toBe(withDefault);
  });

  it('DEFAULT_READINESS_WEIGHTS encodes the PM036 seam contract (0.6 / 0.25 / 0.15)', () => {
    expect(DEFAULT_READINESS_WEIGHTS).toEqual({ wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15 });
  });
});
