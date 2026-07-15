import { describe, it, expect } from 'vitest';
import { goalForSlug, goalMet, goalPercent, exceededBy, goalFraction } from './goals.js';

describe('goalForSlug (legacy shim source)', () => {
  it('returns the configured goal for a known slug', () => {
    expect(goalForSlug('patient-care-experience')).toBe(1000);
  });
  it('returns null for a no-minimum slug', () => {
    expect(goalForSlug('employment')).toBeNull();
    expect(goalForSlug('extracurricular-activities')).toBeNull();
  });
  it('returns null for an unknown slug (fail-open)', () => {
    expect(goalForSlug('unknown-slug')).toBeNull();
  });
});

describe('goalMet', () => {
  it('is true when hours meet a non-null goal', () => {
    expect(goalMet(500, 500)).toBe(true);
  });
  it('is false below the goal', () => {
    expect(goalMet(500, 499)).toBe(false);
  });
  it('is false for a null goal regardless of hours', () => {
    expect(goalMet(null, 9999)).toBe(false);
  });
});

describe('goalPercent', () => {
  it('computes percent of a non-null goal', () => {
    expect(goalPercent(300, 150)).toBe(50);
  });
  it('caps at 100', () => {
    expect(goalPercent(300, 600)).toBe(100);
  });
  it('returns null for a null goal', () => {
    expect(goalPercent(null, 50)).toBeNull();
  });
});

describe('exceededBy', () => {
  it('returns the overage above a non-null goal', () => {
    expect(exceededBy(500, 606)).toBe(106);
  });
  it('returns null below the goal', () => {
    expect(exceededBy(500, 400)).toBeNull();
  });
  it('returns null for a null goal', () => {
    expect(exceededBy(null, 50)).toBeNull();
  });
});

describe('goalFraction (readiness goalProgress contribution)', () => {
  it('contributes min(1, hours/goal) for a goal-bearing category', () => {
    // goalHours 1000 with 500 logged hours → 0.5
    expect(goalFraction(1000, 500)).toBe(0.5);
  });
  it('caps at 1 when hours exceed the goal', () => {
    expect(goalFraction(1000, 2000)).toBe(1);
  });
  it('is excluded (null) when the category has no goal', () => {
    // goalHours null → not goal-bearing → null (excluded from the mean)
    expect(goalFraction(null, 500)).toBeNull();
  });
});
