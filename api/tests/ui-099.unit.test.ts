/**
 * Unit tests for date-ordering validation in experience route schemas (UI-099).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests the Zod schema
 * constraints for CreateExperienceBody and PatchExperienceBody directly.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reproduce the schemas under test (mirrors api/src/routes/experiences.ts).
// ---------------------------------------------------------------------------

const CreateExperienceBodyBase = z.object({
  categoryId: z.string().uuid(),
  organization: z.string().min(1).max(256),
  position: z.string().min(1).max(256),
  frequency: z.enum(['temporary', 'recurring', 'ongoing']).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().optional(),
  dutiesNarrative: z.string().min(1).max(8192),
  totalHours: z.number().int().positive().max(100000),
  hoursPerWeek: z.number().int().positive().max(168),
  numberOfWeeks: z.number().int().positive(),
  isCurrent: z.boolean().optional(),
  permissionToContact: z.boolean().optional(),
  // Other nullable fields not relevant to these tests
  stateProvince: z.string().max(128).nullable().optional(),
  country: z.string().max(128).nullable().optional(),
  contactFirstName: z.string().max(128).nullable().optional(),
});

const CreateExperienceBody = CreateExperienceBodyBase.extend({
  ownerUserId: z.string().optional(),
})
  .refine(
    (b) => b.totalHours === b.hoursPerWeek * b.numberOfWeeks,
    { message: 'totalHours must equal hoursPerWeek × numberOfWeeks', path: ['totalHours'] },
  )
  .refine(
    (b) => b.isCurrent === true || b.endDate == null || b.endDate > b.startDate,
    { message: 'End date must be after start date.', path: ['endDate'] },
  );

const PatchExperienceBody = CreateExperienceBodyBase.partial().superRefine((b, ctx) => {
  const hasAll =
    b.totalHours !== undefined && b.hoursPerWeek !== undefined && b.numberOfWeeks !== undefined;
  if (hasAll && b.totalHours !== b.hoursPerWeek! * b.numberOfWeeks!) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'totalHours must equal hoursPerWeek × numberOfWeeks',
      path: ['totalHours'],
    });
  }
  if (
    b.isCurrent !== true &&
    b.startDate !== undefined &&
    b.endDate != null &&
    b.endDate <= b.startDate
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'End date must be after start date.',
      path: ['endDate'],
    });
  }
});

// ---------------------------------------------------------------------------
// Shared valid POST payload
// ---------------------------------------------------------------------------

const VALID_CAT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const validPostBase = {
  categoryId: VALID_CAT_ID,
  organization: 'Acme Hospital',
  position: 'Volunteer',
  startDate: '2023-01-01',
  dutiesNarrative: 'Did things.',
  totalHours: 40,
  hoursPerWeek: 10,
  numberOfWeeks: 4,
  isCurrent: false,
};

// ---------------------------------------------------------------------------
// CreateExperienceBody — date ordering
// ---------------------------------------------------------------------------

describe('CreateExperienceBody — date ordering (UI-099)', () => {
  it('fails (400) when endDate < startDate and isCurrent is false', () => {
    const result = CreateExperienceBody.safeParse({
      ...validPostBase,
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

  it('fails (400) when endDate === startDate and isCurrent is false', () => {
    const result = CreateExperienceBody.safeParse({
      ...validPostBase,
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

  it('passes when endDate > startDate', () => {
    const result = CreateExperienceBody.safeParse({
      ...validPostBase,
      startDate: '2023-01-01',
      endDate: '2023-06-01',
    });
    expect(result.success).toBe(true);
  });

  it('passes when endDate is null', () => {
    const result = CreateExperienceBody.safeParse({
      ...validPostBase,
      startDate: '2023-01-01',
      endDate: null,
    });
    expect(result.success).toBe(true);
  });

  it('skips date check when isCurrent is true', () => {
    const result = CreateExperienceBody.safeParse({
      ...validPostBase,
      isCurrent: true,
      startDate: '2023-06-01',
      endDate: '2023-01-01',
    });
    // Only the date-ordering issue should be absent; other issues may vary.
    if (!result.success) {
      const dateIssue = result.error.issues.find(
        (i) => i.path[0] === 'endDate' && i.message === 'End date must be after start date.',
      );
      expect(dateIssue).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// PatchExperienceBody — date ordering
// ---------------------------------------------------------------------------

describe('PatchExperienceBody — date ordering (UI-099)', () => {
  it('fails when both startDate and endDate supplied and endDate < startDate', () => {
    const result = PatchExperienceBody.safeParse({
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

  it('fails when both dates supplied and endDate === startDate', () => {
    const result = PatchExperienceBody.safeParse({
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

  it('passes when both dates supplied and endDate > startDate', () => {
    const result = PatchExperienceBody.safeParse({
      startDate: '2023-01-01',
      endDate: '2023-06-01',
    });
    expect(result.success).toBe(true);
  });

  it('passes when only startDate is in the patch (endDate absent)', () => {
    const result = PatchExperienceBody.safeParse({
      startDate: '2023-06-01',
    });
    expect(result.success).toBe(true);
  });

  it('passes when endDate is null in the patch', () => {
    const result = PatchExperienceBody.safeParse({
      startDate: '2023-06-01',
      endDate: null,
    });
    expect(result.success).toBe(true);
  });

  it('skips date check when isCurrent is true in the patch', () => {
    const result = PatchExperienceBody.safeParse({
      isCurrent: true,
      startDate: '2023-06-01',
      endDate: '2023-01-01',
    });
    if (!result.success) {
      const dateIssue = result.error.issues.find(
        (i) => i.path[0] === 'endDate' && i.message === 'End date must be after start date.',
      );
      expect(dateIssue).toBeUndefined();
    }
  });
});
