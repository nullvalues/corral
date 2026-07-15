import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isOwner, hasMentorGrant } from '../services/auth/abacPredicates.js';
import { denyRole } from '../services/auth/rbacGuard.js';
import { requireAuth } from '../services/auth/requireAuth.js';
import {
  listExperiencesByOwner,
  getExperienceById,
  createExperience,
  updateExperience,
  deleteExperience,
  applyPiiGate,
  getRollupByOwner,
  verifyExperience,
} from '../services/experiences.js';
import { insertPiiAccessLog } from '../services/pii-access-log.js';
import { getUserById } from '../services/users.js';
import { getMyRoles } from '../services/me.js';
import { ErrorSchema } from './shared-schemas.js';

// CSV column order for GET /api/experiences/export (API-062).
const EXPORT_COLUMNS = [
  'organization',
  'position',
  'category',
  'frequency',
  'startDate',
  'endDate',
  'totalHours',
  'hoursPerWeek',
  'numberOfWeeks',
  'isVolunteer',
  'receivedSalaryOrPayment',
  'receivedAcademicCredit',
  'isMostImportant',
  'verificationStatus',
  'stateProvince',
  'country',
] as const;

/**
 * Escapes a single CSV field per RFC 4180: fields containing a double quote,
 * comma, or newline are wrapped in double quotes with embedded quotes doubled.
 */
function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const ExperienceResponseSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string(),
  categoryId: z.string().uuid(),
  organization: z.string(),
  position: z.string(),
  frequency: z.string().nullable(),
  startDate: z.date(),
  endDate: z.date().nullable(),
  dutiesNarrative: z.string(),
  totalHours: z.number().int(),
  hoursPerWeek: z.number().int(),
  numberOfWeeks: z.number().int(),
  // Location columns — all nullable
  stateProvince: z.string().nullable(),
  stateProvinceCode: z.string().nullable(),
  country: z.string().nullable(),
  countryIso2: z.string().nullable(),
  countryIso3: z.string().nullable(),
  // Attestation booleans — all NOT NULL
  isCurrent: z.boolean(),
  receivedAcademicCredit: z.boolean(),
  receivedSalaryOrPayment: z.boolean(),
  isVolunteer: z.boolean(),
  isMostImportant: z.boolean(),
  permissionToContact: z.boolean(),
  // Contact PII fields — all nullable
  contactTitle: z.string().nullable(),
  contactFirstName: z.string().nullable(),
  contactLastName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  // Verification fields (DB-021, ADR-035, API-033)
  verificationStatus: z.string().pipe(z.enum(['unverified', 'verified'])),
  verifiedByUserId: z.string().nullable(),
  verifiedAt: z.date().nullable(),
});

const RollupItemSchema = z.object({
  categoryId: z.string().uuid(),
  categorySlug: z.string(),
  categoryName: z.string(),
  totalHours: z.number().int(),
});

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
  stateProvince: z.string().max(128).nullable().optional(),
  stateProvinceCode: z.string().max(8).nullable().optional(),
  country: z.string().max(128).nullable().optional(),
  countryIso2: z.string().length(2).nullable().optional(),
  countryIso3: z.string().length(3).nullable().optional(),
  isCurrent: z.boolean().optional(),
  receivedAcademicCredit: z.boolean().optional(),
  receivedSalaryOrPayment: z.boolean().optional(),
  isVolunteer: z.boolean().optional(),
  isMostImportant: z.boolean().optional(),
  permissionToContact: z.boolean().optional(),
  contactTitle: z.string().max(128).nullable().optional(),
  contactFirstName: z.string().max(128).nullable().optional(),
  contactLastName: z.string().max(128).nullable().optional(),
  contactEmail: z.string().max(320).nullable().optional(),
  contactPhone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/)
    .nullable()
    .optional(),
});

// POST body extends base with ownerUserId so a mentor can post on behalf of an applicant.
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

// PATCH body is derived from base only — ownerUserId is intentionally absent so
// ownership reassignment is structurally impossible via PATCH (API-016).
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

async function assertWriteAccess(callerId: string, experienceId: string) {
  const exp = await getExperienceById(experienceId);
  const ownerId = exp?.ownerUserId ?? '';
  const owned = isOwner(callerId, { ownerId });
  const granted = owned ? false : await hasMentorGrant(callerId, ownerId, 'write');
  return { denied: !owned && !granted, exp: !owned && !granted ? null : exp };
}

const experiencesRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/experiences',
    {
      preHandler: [requireAuth()],
      schema: {
        querystring: z.object({ owner_user_id: z.string() }),
        response: {
          200: z.array(ExperienceResponseSchema),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const caller = req.user!;
      const ownerId = req.query.owner_user_id;
      const owned = isOwner(caller.id, { ownerId });
      const granted = owned ? false : await hasMentorGrant(caller.id, ownerId, 'read');
      if (!owned && !granted) return reply.status(403).send({ error: 'Forbidden' });
      const exps = await listExperiencesByOwner(ownerId);
      // Roster-level audit log: record that the caller queried the list (ADR-031, API-027).
      // Fires unconditionally on every authenticated list call, regardless of permissionToContact.
      insertPiiAccessLog({
        actorUserId: caller.id,
        action: 'read',
        resourceType: 'experience',
        subjectUserId: ownerId,
        viaGrant: !owned,
      });
      if (!owned) {
        for (const exp of exps) {
          if (exp.permissionToContact) {
            insertPiiAccessLog({ actorUserId: caller.id, action: 'read', resourceType: 'experience', resourceId: exp.id, subjectUserId: exp.ownerUserId, viaGrant: true });
          }
        }
      }
      return exps.map((e) => applyPiiGate(e, owned));
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/experiences/rollup',
    {
      preHandler: [requireAuth()],
      schema: {
        querystring: z.object({ owner_user_id: z.string() }),
        response: {
          200: z.array(RollupItemSchema),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const caller = req.user!;
      const ownerId = req.query.owner_user_id;
      const owned = isOwner(caller.id, { ownerId });
      const granted = owned ? false : await hasMentorGrant(caller.id, ownerId, 'read');
      if (!owned && !granted) return reply.status(403).send({ error: 'Forbidden' });
      return getRollupByOwner(ownerId);
    },
  );

  // GET /experiences/export — CSV export of a user's experiences (API-062).
  // Declared before /experiences/:id so the static path is not shadowed by the
  // param route (Fastify's static-over-param precedence also guarantees this;
  // the ordering here is belt-and-braces).
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/experiences/export',
    {
      preHandler: [requireAuth()],
      schema: {
        querystring: z.object({ owner_user_id: z.string().optional() }),
        response: {
          // No 200 schema: the Zod serializer would JSON.stringify (quote-wrap)
          // the CSV body. Omitting it lets Fastify send the raw string as-is
          // under the explicit text/csv Content-Type set below.
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const caller = req.user!;
      const ownerId = req.query.owner_user_id ?? caller.id;
      if (ownerId !== caller.id) {
        const roles = await getMyRoles(caller.id);
        if (!roles.includes('admin')) {
          return reply.status(403).send({ error: 'Forbidden' });
        }
      }
      const rows = await listExperiencesByOwner(ownerId);
      const header = EXPORT_COLUMNS.join(',');
      const lines = rows.map((row) =>
        EXPORT_COLUMNS.map((col) =>
          toCsvValue((row as Record<string, unknown>)[col === 'category' ? 'categoryId' : col]),
        ).join(','),
      );
      const csv = [header, ...lines].join('\r\n');
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="experiences-export.csv"')
        // Cast: the 200 CSV body is a raw string, but the typed response union
        // only covers the 401/403 error schemas (200 has no schema by design).
        .send(csv as never);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/experiences/:id',
    {
      preHandler: [requireAuth()],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: ExperienceResponseSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const caller = req.user!;
      const exp = await getExperienceById(req.params.id);
      // Use empty string sentinel if exp doesn't exist — will fail ABAC check
      const ownerId = exp?.ownerUserId ?? '';
      const owned = isOwner(caller.id, { ownerId });
      const granted = owned ? false : await hasMentorGrant(caller.id, ownerId, 'read');
      if (!owned && !granted) return reply.status(403).send({ error: 'Forbidden' });
      if (!exp) return reply.status(404).send({ error: 'Not found' });
      if (!owned && exp.permissionToContact) {
        insertPiiAccessLog({ actorUserId: caller.id, action: 'read', resourceType: 'experience', resourceId: exp.id, subjectUserId: exp.ownerUserId, viaGrant: true });
      }
      return applyPiiGate(exp, owned);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/experiences',
    {
      schema: {
        body: CreateExperienceBody,
        response: { 201: ExperienceResponseSchema, 401: ErrorSchema, 403: ErrorSchema },
      },
      preHandler: [requireAuth(), denyRole('admin')],
    },
    async (req, reply) => {
      const caller = req.user!;
      let ownerUserId = caller.id;
      if (req.body.ownerUserId && req.body.ownerUserId !== caller.id) {
        const ok = await hasMentorGrant(caller.id, req.body.ownerUserId, 'write');
        if (!ok) return reply.status(403).send({ error: 'Forbidden' });
        ownerUserId = req.body.ownerUserId;
      }
      const exp = await createExperience({ ...req.body, ownerUserId });
      if (ownerUserId !== caller.id) {
        insertPiiAccessLog({ actorUserId: caller.id, action: 'create', resourceType: 'experience', resourceId: exp.id, subjectUserId: ownerUserId, viaGrant: true });
      }
      return reply.status(201).send(exp);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/experiences/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: PatchExperienceBody,
        response: {
          200: ExperienceResponseSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
      preHandler: [requireAuth(), denyRole('admin')],
    },
    async (req, reply) => {
      const { denied, exp } = await assertWriteAccess(req.user!.id, req.params.id);
      if (denied) return reply.status(403).send({ error: 'Forbidden' });
      if (!exp) return reply.status(404).send({ error: 'Not found' });
      const updated = await updateExperience(req.params.id, req.body);
      if (!isOwner(req.user!.id, { ownerId: exp.ownerUserId })) {
        insertPiiAccessLog({ actorUserId: req.user!.id, action: 'update', resourceType: 'experience', resourceId: exp.id, subjectUserId: exp.ownerUserId, viaGrant: true });
      }
      return updated!;
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/experiences/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: z.undefined(),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
      preHandler: [requireAuth(), denyRole('admin')],
    },
    async (req, reply) => {
      const { denied, exp } = await assertWriteAccess(req.user!.id, req.params.id);
      if (denied) return reply.status(403).send({ error: 'Forbidden' });
      if (!exp) return reply.status(404).send({ error: 'Not found' });
      await deleteExperience(req.params.id);
      return reply.status(204).send();
    },
  );

  // PATCH /experiences/:id/verification — mentor verify/un-verify (API-033, ADR-035, API-037).
  // Mentor access is enforced by the active `write` grant requirement inside verifyExperience
  // (ABAC). denyRole('admin') excludes admins from acting as mentors. A caller holding both
  // the 'applicant' role AND an active write grant may verify — the grant is the entitlement,
  // not the absence of the applicant role.
  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/experiences/:id/verification',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ action: z.enum(['verify', 'unverify']) }),
        response: {
          200: ExperienceResponseSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
      preHandler: [requireAuth(), denyRole('admin')],
    },
    async (req, reply) => {
      const result = await verifyExperience(req.user!.id, req.params.id, req.body.action);
      if (!result.ok) {
        // All failure modes return 403 — existence is not disclosed to callers without a grant.
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // Fire-and-forget notification email — a mailer failure must not turn a
      // successful verification into a 500 (API-061).
      const exp = result.experience;
      const mailer = fastify.mailer;
      void Promise.all([
        getUserById(exp.ownerUserId),
        getUserById(req.user!.id),
      ]).then(([ownerUser, verifierUser]) => {
        if (!ownerUser || !verifierUser) return;
        const opts = {
          to: ownerUser.email,
          experienceOrg: exp.organization,
          experiencePosition: exp.position,
          verifierName: verifierUser.name,
        };
        if (req.body.action === 'verify') {
          return mailer.sendExperienceVerified(opts);
        } else {
          return mailer.sendExperienceUnverified(opts);
        }
      }).catch((err: unknown) => {
        fastify.log.warn({ err }, '[mailer] sendExperience notification failed');
      });

      return exp;
    },
  );
};

export default experiencesRoutes;
