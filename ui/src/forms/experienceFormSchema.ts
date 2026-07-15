import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const optionalText = (inner: z.ZodString) =>
  z.preprocess((v) => (v === '' ? null : v), inner.nullable().optional());

export const experienceFormSchema = z
  .object({
    categoryId: z.string().uuid(),
    organization: z.string().min(1).max(256),
    position: z.string().min(1).max(256),
    frequency: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['temporary', 'recurring', 'ongoing']).optional(),
    ),
    startDate: z.string().regex(dateRegex, 'Required (YYYY-MM-DD)'),
    endDate: z.preprocess(
      (v) => (v === '' ? null : v),
      z.string().regex(dateRegex, 'Required (YYYY-MM-DD)').nullable().optional(),
    ),
    totalHours: z.number().int().min(1).max(100000),
    hoursPerWeek: z.number().int().min(1).max(168),
    numberOfWeeks: z.number().int().min(1).max(5200),
    dutiesNarrative: z.string().min(1, 'Duties narrative is required').max(8192),
    // Location — stateProvinceCode/countryIso2/countryIso3 omitted from form (not user-editable)
    stateProvince: optionalText(z.string().max(128)),
    country: optionalText(z.string().max(128)),
    // Attestation booleans — must match DB column names exactly
    isCurrent: z.boolean().optional(),
    receivedAcademicCredit: z.boolean().optional(),
    receivedSalaryOrPayment: z.boolean().optional(),
    isVolunteer: z.boolean().optional(),
    isMostImportant: z.boolean().optional(),
    permissionToContact: z.boolean().optional(),
    // Contact
    contactFirstName: optionalText(z.string().max(128)),
    contactLastName: optionalText(z.string().max(128)),
    contactTitle: optionalText(z.string().max(128)),
    contactEmail: z.preprocess(
      (v) => (v === '' ? null : v),
      z.string().email().nullable().optional(),
    ),
    contactPhone: z.preprocess(
      (v) => (v === '' ? null : v),
      z.string().regex(/^\+[1-9]\d{1,14}$/).nullable().optional(),
    ),
  })
  .superRefine((b, ctx) => {
    if (b.totalHours !== b.hoursPerWeek * b.numberOfWeeks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Hours, hours/week, and weeks must satisfy: totalHours = hoursPerWeek × numberOfWeeks',
        path: ['totalHours'],
      });
    }
    if (
      !b.isCurrent &&
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

export type ExperienceFormValues = z.infer<typeof experienceFormSchema>;
