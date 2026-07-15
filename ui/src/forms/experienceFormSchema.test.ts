/**
 * Unit tests for experienceFormSchema date-ordering validation (UI-099).
 */

import { describe, it, expect } from 'vitest';
import { experienceFormSchema } from './experienceFormSchema.js';

// ---------------------------------------------------------------------------
// Minimal valid base values — all required fields satisfied.
// Hours triple: 40 = 10 * 4
// ---------------------------------------------------------------------------

const validBase = {
  categoryId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  organization: 'Acme Hospital',
  position: 'Volunteer',
  startDate: '2023-01-01',
  totalHours: 40,
  hoursPerWeek: 10,
  numberOfWeeks: 4,
  dutiesNarrative: 'Helped patients.',
  isCurrent: false,
};

describe('experienceFormSchema — date ordering (UI-099)', () => {
  it('fails when endDate is before startDate (isCurrent: false)', () => {
    const result = experienceFormSchema.safeParse({
      ...validBase,
      startDate: '2023-06-01',
      endDate: '2023-01-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === 'endDate' && i.message === 'End date must be after start date.',
      );
      expect(issue).toBeDefined();
    }
  });

  it('fails when endDate equals startDate (isCurrent: false)', () => {
    const result = experienceFormSchema.safeParse({
      ...validBase,
      startDate: '2023-06-01',
      endDate: '2023-06-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === 'endDate' && i.message === 'End date must be after start date.',
      );
      expect(issue).toBeDefined();
    }
  });

  it('passes when endDate is after startDate', () => {
    const result = experienceFormSchema.safeParse({
      ...validBase,
      startDate: '2023-01-01',
      endDate: '2023-06-01',
    });
    expect(result.success).toBe(true);
  });

  it('passes when endDate is null (no end date provided)', () => {
    const result = experienceFormSchema.safeParse({
      ...validBase,
      startDate: '2023-01-01',
      endDate: null,
    });
    expect(result.success).toBe(true);
  });

  it('passes when endDate is absent (undefined)', () => {
    const result = experienceFormSchema.safeParse({
      ...validBase,
      startDate: '2023-01-01',
      // endDate not present
    });
    expect(result.success).toBe(true);
  });

  it('skips date check when isCurrent is true even if endDate <= startDate', () => {
    const result = experienceFormSchema.safeParse({
      ...validBase,
      isCurrent: true,
      startDate: '2023-06-01',
      endDate: '2023-01-01',
    });
    // The date-ordering check is skipped; only a potential hours-triple error could arise.
    if (!result.success) {
      const dateIssue = result.error.issues.find(
        (i) => i.path[0] === 'endDate' && i.message === 'End date must be after start date.',
      );
      expect(dateIssue).toBeUndefined();
    }
    // No date-ordering issue should appear regardless of success/failure.
  });
});
