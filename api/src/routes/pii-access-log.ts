// GET /api/admin/pii-log — admin-only read-only pii_access_log listing. API-TEST-025.
// IMPORTANT: No module-scope db import — db is accessed through the service layer only.
// Module-scope db imports cause vi.resetModules() + dynamic import in cors.test.ts /
// rate-limiter.test.ts to hang (5000ms timeout). See story instructions.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listPiiAccessLog } from '../services/pii-access-log.js';
import { requireRole } from '../services/auth/rbacGuard.js';

const PiiAccessLogRowSchema = z.object({
  id: z.string(),
  actorUserId: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  subjectUserId: z.string().nullable(),
  viaGrant: z.boolean(),
  createdAt: z.date(),
});

const piiAccessLogRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/admin/pii-log',
    {
      preHandler: requireRole('admin'),
      schema: {
        querystring: z.object({
          mentorUserId: z.string().optional(),
          applicantUserId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
        response: {
          200: z.array(PiiAccessLogRowSchema),
        },
      },
    },
    async (req, reply) => {
      const rows = await listPiiAccessLog({
        mentorUserId: req.query.mentorUserId,
        applicantUserId: req.query.applicantUserId,
        limit: req.query.limit,
      });
      return reply.status(200).send(rows);
    },
  );
};

export default piiAccessLogRoutes;
