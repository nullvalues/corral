/**
 * GET /api/mentor/impact — derived mentor impact statistics (API-040).
 *
 * Self-scoped: the handler passes `req.user.id` only — there is no query param
 * that selects the subject, so a caller can never read another mentor's stats.
 * This is the ABAC guarantee for this endpoint. There is intentionally NO RBAC
 * role gate (mentorship is grant-based, not role-based); admins calling it
 * simply receive their own (likely empty) stats.
 *
 * The figures are computed on demand — see services/mentor-impact.ts for the
 * no-table / createdAt-proxy rationale.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getMentorImpact } from '../services/mentor-impact.js';
import { listTalentPool } from '../services/talent-pool.js';
import { upsertShortlistReview } from '../services/interview-shortlist.js';
import { getApplicantProfileForMentor } from '../services/profile.js';
import { insertPiiAccessLog } from '../services/pii-access-log.js';
import { hasMentorGrant } from '../services/auth/abacPredicates.js';
import { requireAuth } from '../services/auth/requireAuth.js';
import { ErrorSchema } from './shared-schemas.js';

const MentorImpactSchema = z.object({
  monthHoursVerified: z.number(),
  lifetimeHoursVerified: z.number(),
  applicantsMentored: z.number(),
  avgTurnaroundHours: z.number().nullable(),
  streakDays: z.number(),
  pendingVerifications: z.number(),
});

const TalentCategorySchema = z.object({
  categoryId: z.string().uuid(),
  categorySlug: z.string(),
  categoryName: z.string(),
  totalHours: z.number().int(),
  experienceCount: z.number().int(),
  verifiedCount: z.number().int(),
});

const TalentPoolEntrySchema = z.object({
  applicantUserId: z.string(),
  applicantName: z.string(),
  applicantEmail: z.string(),
  categories: z.array(TalentCategorySchema),
  experienceCount: z.number().int(),
  verifiedCount: z.number().int(),
  activeCategoryCount: z.number().int(),
  shortlisted: z.boolean(),
  starRating: z.number().int().nullable(),
});

const ReviewBody = z.object({
  shortlisted: z.boolean(),
  starRating: z.number().int().min(0).max(5).nullable(),
});

const MentorProfileSchema = z.object({
  name:         z.string(),
  school:       z.string().nullable(),
  graduationYear: z.number().int().nullable(),
  bio:          z.string().nullable(),
  major:        z.string().nullable(),
  linkedinUrl:  z.string().nullable(),
  portfolioUrl: z.string().nullable(),
});

const ShortlistRowSchema = z.object({
  reviewerUserId: z.string(),
  applicantUserId: z.string(),
  shortlisted: z.boolean(),
  starRating: z.number().int().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const mentorRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/mentor/impact',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          200: MentorImpactSchema,
          401: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return reply.status(200).send(await getMentorImpact(req.user!.id));
    },
  );

  // GET /api/mentor/talent-pool — grant-scoped ranked candidate components.
  // ABAC-scoped, NOT role-gated (D5: no selection role). Returns raw readiness
  // components + the caller's own shortlist row; the client computes + ranks.
  typed.get(
    '/mentor/talent-pool',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          200: z.array(TalentPoolEntrySchema),
          401: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return reply.status(200).send(await listTalentPool(req.user!.id));
    },
  );

  // PATCH /api/mentor/applicants/:id/review — reviewer-owned shortlist upsert.
  // Gated by hasMentorGrant(caller, :id, 'read'); the missing-applicant and
  // no-grant cases collapse to an identical 403 (non-disclosure, CER-035). The
  // write always targets reviewer_user_id = caller (reviewer ownership, D7).
  typed.patch(
    '/mentor/applicants/:id/review',
    {
      preHandler: [requireAuth()],
      schema: {
        params: z.object({ id: z.string().min(1) }),
        body: ReviewBody,
        response: { 200: ShortlistRowSchema, 401: ErrorSchema, 403: ErrorSchema },
      },
    },
    async (req, reply) => {
      const granted = await hasMentorGrant(req.user!.id, req.params.id, 'read');
      if (!granted) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const row = await upsertShortlistReview(req.user!.id, req.params.id, req.body);
      return reply.status(200).send(row);
    },
  );

  // GET /api/mentor/applicants/:id/profile — mentor-scoped applicant profile read
  // (API-057). ABAC-gated by hasMentorGrant(caller, :id, 'read'); the no-grant and
  // missing-applicant cases collapse to an identical 403 (non-disclosure, CER-035),
  // matching the sibling review route. Returns the mentor-visible field subset —
  // never `phone` or `gpa`. On success, writes a pii_access_log 'read' row.
  typed.get(
    '/mentor/applicants/:id/profile',
    {
      preHandler: [requireAuth()],
      schema: {
        params: z.object({ id: z.string().min(1) }),
        response: { 200: MentorProfileSchema, 401: ErrorSchema, 403: ErrorSchema },
      },
    },
    async (req, reply) => {
      const applicantUserId = req.params.id;
      const granted = await hasMentorGrant(req.user!.id, applicantUserId, 'read');
      if (!granted) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const profile = await getApplicantProfileForMentor(applicantUserId);
      if (!profile) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      // resourceId is null by design: pii_access_log.resource_id is typed uuid,
      // but user_profiles PK is a non-uuid BA user id. The applicant is already
      // identified by subjectUserId (API-057 amended spec).
      insertPiiAccessLog({
        actorUserId: req.user!.id,
        action: 'read',
        resourceType: 'user_profile',
        resourceId: null,
        subjectUserId: applicantUserId,
        viaGrant: true,
      });
      return reply.status(200).send(profile);
    },
  );
};

export default mentorRoutes;
