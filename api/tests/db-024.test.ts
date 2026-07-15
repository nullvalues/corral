/**
 * DB-024 test: nullable goal_hours column on experience_categories.
 *
 * Unit tests run always (no DB required).
 *
 * Unit tests verify:
 *   - experienceCategories schema object exposes a goalHours key
 *   - CATEGORIES from seed.ts includes a goalHours field on every entry
 *   - employment and extracurricular-activities have goalHours: null
 *   - goal-bearing slugs have the correct positive integer values
 */

import { describe, it, expect } from 'vitest';
import * as experiencesSchema from '../src/db/schema/experiences.js';
import { CATEGORIES } from '../src/db/seed.js';

// --- Unit tests (no DB) ---

describe('DB-024: experienceCategories schema (unit)', () => {
  it('experienceCategories exposes goalHours key', () => {
    expect(Object.keys(experiencesSchema.experienceCategories)).toContain('goalHours');
  });
});

describe('DB-024: CATEGORIES seed entries (unit)', () => {
  it('every CATEGORIES entry has a goalHours field', () => {
    for (const cat of CATEGORIES) {
      expect(cat, `${cat.slug} should have goalHours`).toHaveProperty('goalHours');
    }
  });

  it('employment has goalHours: null', () => {
    const employment = CATEGORIES.find((c) => c.slug === 'employment');
    expect(employment).toBeDefined();
    expect(employment!.goalHours).toBeNull();
  });

  it('extracurricular-activities has goalHours: null', () => {
    const extracurricular = CATEGORIES.find((c) => c.slug === 'extracurricular-activities');
    expect(extracurricular).toBeDefined();
    expect(extracurricular!.goalHours).toBeNull();
  });

  it('patient-care-experience has goalHours: 1000', () => {
    const cat = CATEGORIES.find((c) => c.slug === 'patient-care-experience');
    expect(cat).toBeDefined();
    expect(cat!.goalHours).toBe(1000);
  });

  it('healthcare-experience has goalHours: 500', () => {
    const cat = CATEGORIES.find((c) => c.slug === 'healthcare-experience');
    expect(cat).toBeDefined();
    expect(cat!.goalHours).toBe(500);
  });

  it('volunteer-experience has goalHours: 300', () => {
    const cat = CATEGORIES.find((c) => c.slug === 'volunteer-experience');
    expect(cat).toBeDefined();
    expect(cat!.goalHours).toBe(300);
  });

  it('research-experience has goalHours: 300', () => {
    const cat = CATEGORIES.find((c) => c.slug === 'research-experience');
    expect(cat).toBeDefined();
    expect(cat!.goalHours).toBe(300);
  });
});
