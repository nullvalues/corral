import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listMentorGrants, createMentorGrant, updateMentorGrant, getMentorGrantById, listMyMentorGrants, listMyApplicantGrants, requestMentorGrant } from '../services/mentor-grants.js';
import { requireRole, denyRole } from '../services/auth/rbacGuard.js';
import { requireAuth } from '../services/auth/requireAuth.js';
import { insertAdminActionLog } from '../services/adminActionLog.js';
import { insertPiiAccessLog } from '../services/pii-access-log.js';
import { getUserById } from '../services/users.js';
import { ErrorSchema } from './shared-schemas.js';

const MentorGrantResponseSchema = z.object({
  id: z.string(),
  mentorUserId: z.string(),
  applicantUserId: z.string(),
  permissions: z.array(z.string()),
  grantedByUserId: z.string(),
  grantedAt: z.date(),
  status: z.string(),
  requestedByUserId: z.string().nullable().optional(),
});

const MentorGrantEnrichedSchema = MentorGrantResponseSchema.extend({
  applicantName: z.string(),
  applicantEmail: z.string(),
  mentorName: z.string(),
  mentorEmail: z.string(),
});

const MentorGrantWithApplicantSchema = MentorGrantResponseSchema.extend({
  applicantName: z.string(),
  applicantEmail: z.string(),
});

const MentorGrantWithMentorSchema = MentorGrantResponseSchema.extend({
  mentorName: z.string(),
  mentorEmail: z.string(),
});

const PermissionsSchema = z.array(z.enum(['read', 'write']));

const CreateMentorGrantBody = z.object({
  mentorUserId: z.string().min(1),
  applicantUserId: z.string().min(1),
  permissions: PermissionsSchema,
});

const PatchMentorGrantBody = z.object({
  status: z.enum(['active', 'revoked']).optional(),
  permissions: PermissionsSchema.optional(),
});

const mentorGrantsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/mentor-grants',
    {
      preHandler: requireRole('admin'),
      schema: {
        querystring: z.object({
          mentorUserId: z.string().optional(),
          applicantUserId: z.string().optional(),
          status: z.enum(['pending', 'active', 'revoked']).optional(),
        }),
        response: {
          200: z.array(MentorGrantEnrichedSchema),
        },
      },
    },
    async (req, reply) => {
      const grants = await listMentorGrants(req.query);
      insertPiiAccessLog({
        actorUserId: req.user!.id,
        action: 'read',
        resourceType: 'mentor_grant_list',
        viaGrant: false,
      });
      return reply.status(200).send(grants);
    },
  );

  typed.post(
    '/mentor-grants',
    {
      preHandler: requireRole('admin'),
      schema: {
        body: CreateMentorGrantBody,
        response: {
          201: MentorGrantResponseSchema,
          400: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { mentorUserId, applicantUserId, permissions } = req.body;

      if (mentorUserId === applicantUserId) {
        return reply.status(400).send({ error: 'mentorUserId and applicantUserId must be different' });
      }

      // Verify both users exist (direct API calls bypass any UI validation)
      const mentorUser = await getUserById(mentorUserId);
      if (!mentorUser) {
        return reply.status(400).send({ error: `mentorUserId '${mentorUserId}' does not exist` });
      }
      const applicantUser = await getUserById(applicantUserId);
      if (!applicantUser) {
        return reply.status(400).send({ error: `applicantUserId '${applicantUserId}' does not exist` });
      }

      const grant = await createMentorGrant({
        mentorUserId,
        applicantUserId,
        permissions,
        grantedByUserId: req.user!.id,
      });

      void insertAdminActionLog({
        actorUserId: req.user!.id,
        action: 'grant_create',
        resourceType: 'mentor_grant',
        resourceId: grant.id,
        after: grant,
      });

      return reply.status(201).send(grant);
    },
  );

  typed.get(
    '/mentor-grants/mine',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          200: z.array(MentorGrantWithApplicantSchema),
          401: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const grants = await listMyMentorGrants(req.user!.id);
      return reply.status(200).send(grants);
    },
  );

  typed.get(
    '/mentor-grants/my-requests',
    {
      preHandler: requireRole('applicant'),
      schema: {
        response: {
          200: z.array(MentorGrantWithMentorSchema),
          401: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const grants = await listMyApplicantGrants(req.user!.id);
      return reply.status(200).send(grants);
    },
  );

  typed.post(
    '/mentor-grants/requests',
    {
      preHandler: [requireRole('applicant'), denyRole('admin')],
      schema: {
        body: z.object({
          mentorEmail: z.string().email(),
        }),
        response: {
          201: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      // Anti-enumeration: always return 201 regardless of outcome so callers
      // cannot use the status code to learn whether an email is registered or
      // whether a grant already exists. The actual outcome is logged server-side
      // for operator visibility.
      const result = await requestMentorGrant(req.user!.id, req.body.mentorEmail);
      req.log.info({ outcome: result.error ?? 'created' }, 'mentor grant request');
      return reply.status(201).send({ message: 'Request sent' });
    },
  );

  typed.patch(
    '/mentor-grants/:id',
    {
      preHandler: requireRole('admin'),
      schema: {
        params: z.object({ id: z.string() }),
        body: PatchMentorGrantBody,
        response: {
          200: MentorGrantResponseSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const existing = await getMentorGrantById(req.params.id);
      if (existing === null) {
        return reply.status(404).send({ error: 'Grant not found' });
      }
      const grant = await updateMentorGrant(req.params.id, req.body);
      if (grant === null) {
        return reply.status(404).send({ error: 'Grant not found' });
      }

      await insertAdminActionLog({
        actorUserId: req.user!.id,
        action: 'grant_update',
        resourceType: 'mentor_grant',
        resourceId: req.params.id,
        before: existing,
        after: grant,
      });

      // Write a dedicated grant_review audit log entry when transitioning from pending
      if (
        existing.status === 'pending' &&
        (grant.status === 'active' || grant.status === 'revoked')
      ) {
        await insertAdminActionLog({
          actorUserId: req.user!.id,
          action: 'grant_review',
          resourceType: 'mentor_grant',
          resourceId: req.params.id,
          before: existing,
          after: grant,
        });
      }

      return reply.status(200).send(grant);
    },
  );
};

export default mentorGrantsRoutes;
